import fs from "node:fs";
import Database from "better-sqlite3";
import { parseLiveSession } from "./parse-claude";
import type { LiveSession } from "./types";

/** Verified OpenCode v1 message/part schema, also observed in ZCode 0.16.3/0.16.5. */
type Row = Record<string, any>;
function open(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  try {
    for (const [table, required] of Object.entries({ session: ["id", "title", "directory", "time_created"], message: ["id", "session_id", "data", "time_created"], part: ["id", "message_id", "data", "time_created"] })) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map(r => r.name));
      if (required.some(column => !columns.has(column))) throw new Error(`Unsupported agent database: ${table} schema is not compatible.`);
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
const iso = (at: number) => Number.isFinite(at) && at >= 0 && at <= 8.64e15 ? new Date(at).toISOString() : undefined;
const record = (type: string, content: unknown, at: number, extra: Row = {}) => JSON.stringify({ type, timestamp: iso(at), message: { content, ...extra } });

function* records(db: Database.Database, sessionId: string): Generator<string> {
  const session = db.prepare("SELECT * FROM session WHERE id = ?").get(sessionId) as Row | undefined;
  if (!session) throw new Error("Session is absent from this database.");
  yield JSON.stringify({ type: "system", sessionId, timestamp: iso(session.time_created), cwd: session.directory, subtype: "init" });
  const columns = db.prepare("PRAGMA table_info(message)").all() as Row[];
  const order = columns.some(c => c.name === "sequence") ? "coalesce(sequence, time_created), id" : "time_created, id";
  const partColumns = db.prepare("PRAGMA table_info(part)").all() as Row[];
  const partOrder = partColumns.some(c => c.name === "sequence") ? "coalesce(sequence, time_created), id" : "time_created, id";
  let bytes = 0, count = 0;
  for (const row of db.prepare(`SELECT * FROM message WHERE session_id = ? ORDER BY ${order}`).iterate(sessionId) as Iterable<Row>) {
    bytes += Buffer.byteLength(row.data); count++;
    if (bytes > 32 * 1024 * 1024 || count > 20_000) throw new Error("Agent database session exceeds the 32 MiB / 20,000 message reader limit.");
    let message: Row;
    try { message = JSON.parse(row.data); } catch { yield JSON.stringify({ type: "unsupported", detail: "Malformed message JSON", id: row.id }); continue; }
    if (!["user", "assistant"].includes(message.role)) { yield JSON.stringify({ type: "unsupported", detail: "Unknown message role", id: row.id }); continue; }
    const content: Row[] = [];
    const results: string[] = [];
    for (const partRow of db.prepare(`SELECT * FROM part WHERE message_id = ? ORDER BY ${partOrder}`).iterate(row.id) as Iterable<Row>) {
      bytes += Buffer.byteLength(partRow.data);
      if (bytes > 32 * 1024 * 1024) throw new Error("Agent database session exceeds the 32 MiB reader limit.");
      let part: Row;
      try { part = JSON.parse(partRow.data); } catch { content.push({ type: "text", text: "[Malformed part JSON; raw record unavailable in normalized view]" }); continue; }
      if (part.type === "text") content.push({ type: "text", text: part.text ?? "" });
      else if (part.type === "reasoning") content.push({ type: "thinking", thinking: part.text ?? "" });
      else if (part.type === "file") content.push({ type: "document", source: { type: "unavailable" }, title: part.filename ?? "Attachment reference" });
      else if (part.type === "tool") {
        content.push({ type: "tool_use", id: part.callID, name: part.tool, input: part.state?.input ?? {} });
        if (["completed", "error"].includes(part.state?.status)) results.push(record("user", [{ type: "tool_result", tool_use_id: part.callID, content: part.state.output ?? part.state.error ?? "", is_error: part.state.status === "error" }], part.state.time?.end ?? row.time_created));
      } else if (!["step-start", "step-finish"].includes(part.type)) results.push(JSON.stringify({ type: "unsupported", subtype: part.type, detail: "Unmapped source part retained as metadata", timestamp: iso(row.time_created) }));
    }
    // Message totals already include step usage; never count step-finish copies.
    const tokens = message.role === "assistant" ? message.tokens : undefined;
    const usage = tokens ? { input_tokens: tokens.input, output_tokens: tokens.output, cache_read_input_tokens: tokens.cache?.read, cache_creation_input_tokens: tokens.cache?.write } : undefined;
    yield record(message.role, content, message.time?.created ?? row.time_created, { id: row.id, model: message.role === "assistant" ? message.modelID : undefined, ...(usage ? { usage } : {}) });
    yield* results;
  }
  if (!count) {
    const hasV2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_message'").get();
    if (hasV2) throw new Error("No v1 message records found; this session may use an unsupported storage version.");
  }
}

export function agentDbRecords(file: string, sessionId: string): string[] {
  const db = open(file);
  try { return db.transaction(() => [...records(db, sessionId)])(); } finally { db.close(); }
}

const cache = new Map<string, { revision: string; sessions: LiveSession[] }>();
export function parseAgentDbSessions(file: string): LiveSession[] {
  const stat = fs.statSync(file);
  const wal = fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`) : null;
  const revision = `${stat.mtimeMs}:${stat.size}:${wal?.mtimeMs}:${wal?.size}`;
  const saved = cache.get(file); if (saved?.revision === revision) return saved.sessions;
  const db = open(file);
  try {
    const sessions = db.transaction(() => {
      const output: LiveSession[] = [];
      for (const row of db.prepare("SELECT * FROM session ORDER BY time_created DESC LIMIT 100000").iterate() as Iterable<Row>) {
        try {
          const parsed = parseLiveSession(file, records(db, row.id), stat.size, row.directory, stat.mtimeMs, undefined, undefined, false);
          if (!parsed) continue;
          parsed.sessionId = row.id; parsed.displayTitle = row.title; parsed.path = file;
          parsed.parentSessionId = row.parent_id ?? null; parsed.isSubagent = Boolean(row.parent_id);
          parsed.cliVersion = row.version ?? null;
          parsed.observedProviders = (db.prepare("SELECT DISTINCT json_extract(data, '$.providerID') AS provider FROM message WHERE session_id = ? AND json_valid(data) AND json_extract(data, '$.role') = 'assistant' LIMIT 100").all(row.id) as Row[]).map(r => r.provider).filter((value): value is string => typeof value === "string" && value.length > 0);
          parsed.parseWarnings.push("OpenCode-compatible v1 projection; source cost is not verified billing. Usage comes from assistant message totals.");
          output.push(parsed);
        } catch (error) {
          // Fail visibly instead of publishing a complete-looking partial corpus.
          throw new Error(`Agent database session unsupported: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return output;
    })();
    if (cache.size >= 8) cache.delete(cache.keys().next().value!);
    cache.set(file, { revision, sessions }); return sessions;
  } finally { db.close(); }
}
