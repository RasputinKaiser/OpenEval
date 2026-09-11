import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { parseArgs, textOf } from "../adapters/hermes";
import type { LiveSession } from "./types";
import { parseLiveSession } from "./parse-claude";

/**
 * Hermes (hermes.app / Hermes Agent) state database adapter.
 *
 * The desktop app, TUI, and CLI all append to one authoritative session ledger
 * per profile: `state.db` (SQLite) — one `sessions` row per session with
 * model, provenance, timestamps, tool counts, and — via `session_model_usage`
 * — per-model token usage. Profiles are separate Hermes identities with their
 * own `~/.hermes/profiles/<name>/state.db`, so every matching DB under the
 * source roots is parsed, not just the top-level one. The legacy on-disk
 * `session_*.json` transcripts stopped being written in mid-2026 and record no
 * usage at all, so the DB is the only complete collection source.
 *
 * One DB file expands to many sessions, which does not fit the one-file-
 * one-session cache pipeline; instead each DB is summarized per scan and
 * memoized in-process. Sessions are re-emitted as minimal Claude-style records
 * so `parseLiveSession` supplies the full LiveSession shape (model
 * attribution, usage segments, quality scoring).
 *
 * Costs stay "inferred": Hermes' own estimated_cost_usd rows are unvetted
 * (they even go negative on promo pricing), so the dashboard's list-rate
 * estimates remain the single pricing voice.
 */

interface HermesDbUsageRow {
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

interface HermesDbSessionRow {
  id: string;
  parent_session_id: string | null;
  model: string | null;
  started_at: number; // epoch seconds
  ended_at: number | null; // epoch seconds
  last_activity_at: number | null; // epoch seconds
  message_count: number;
  tool_call_count: number;
  cwd: string | null;
  title: string | null;
  display_name: string | null;
  archived: number;
  hidden: number;
  source?: string | null;
}

interface HermesDbMessageAgg {
  session_id: string;
  user_turns: number;
  first_prompt: string | null;
}

interface HermesDbMessageRow {
  id: number;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  timestamp: number;
  reasoning?: string | null;
  reasoning_content?: string | null;
}

function isoFromEpochSeconds(seconds: unknown): string | null {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function previewText(raw: unknown): string | null {
  const text = textOf(raw).trim();
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function projectName(cwd: string | null): string {
  if (!cwd) return "(hermes)";
  return path.basename(cwd) || cwd;
}

function statOrNull(file: string): { mtimeMs: number; size: number } | null {
  try {
    const s = fs.statSync(file);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

/** Hermes runs with a live WAL; data lands there before the main file moves. */
function walStatFor(dbFile: string): { mtimeMs: number; size: number } {
  return statOrNull(`${dbFile}-wal`) ?? { mtimeMs: 0, size: 0 };
}

/** Cheap exact-freshness probe: the memo is valid only if these all match. */
interface DbFreshnessProbe {
  sessions: number;
  maxActivity: number;
  usageRows: number;
}

function probeDbFreshness(db: Database.Database): DbFreshnessProbe {
  const s = db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(last_activity_at), MAX(started_at), 0) AS a FROM sessions").get() as { n: number; a: number };
  const u = db.prepare("SELECT COUNT(*) AS n FROM session_model_usage").get() as { n: number };
  return { sessions: Number(s?.n) || 0, maxActivity: Number(s?.a) || 0, usageRows: Number(u?.n) || 0 };
}

/**
 * Whole-DB parse memo. Keyed by path; valid only while the DB file stat, its
 * WAL sibling stat, AND the cheap in-DB freshness counters all hold. The WAL
 * matters because Hermes writes continuously — the main DB file's (mtime,
 * size) can stay frozen for hours while every new session lives in the WAL,
 * so a stat-only memo silently hid the newest sessions until a checkpoint.
 * The counters (row counts + MAX activity) change with the data itself, so a
 * hit is exact, not time-based: no TTL re-parse storms on a 1 GB ledger.
 */
interface DbMemoEntry {
  dbMtimeMs: number;
  dbSize: number;
  walMtimeMs: number;
  walSize: number;
  probe: DbFreshnessProbe;
  sessions: LiveSession[];
}
const dbMemo = new Map<string, DbMemoEntry>();

function readDb(file: string): Database.Database | null {
  try {
    return new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

/** Column names present in this DB's messages table (schemas drift, fixtures shrink). */
function messagesColumns(db: Database.Database): Set<string> {
  const cols = new Set<string>();
  try {
    for (const row of db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>) {
      cols.add(row.name);
    }
  } catch {
    // An unopenable messages table means no transcripts; callers handle empty.
  }
  return cols;
}

/**
 * Expand one Hermes state.db into LiveSessions (newest first).
 * Returns [] when the file is missing or not the expected schema.
 */
export function parseHermesDbSessions(file: string, mtime: number, stat?: { mtimeMs: number; size: number }): LiveSession[] {
  const st = stat ?? statOrNull(file) ?? { mtimeMs: mtime, size: 0 };
  const wal = walStatFor(file);

  let db = readDb(file);
  if (!db) return [];
  let probe: DbFreshnessProbe;
  try {
    probe = probeDbFreshness(db);
  } catch {
    db.close();
    return [];
  }
  db.close();

  const memo = dbMemo.get(file);
  if (memo && memo.dbMtimeMs === st.mtimeMs && memo.dbSize === st.size && memo.walMtimeMs === wal.mtimeMs && memo.walSize === wal.size && memo.probe.sessions === probe.sessions && memo.probe.maxActivity === probe.maxActivity && memo.probe.usageRows === probe.usageRows) {
    return memo.sessions;
  }

  db = readDb(file);
  if (!db) return [];
  const sessions: LiveSession[] = [];
  try {
    const usageBySession = new Map<string, HermesDbUsageRow[]>();
    for (const row of db.prepare(
      "SELECT session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM session_model_usage",
    ).all() as HermesDbUsageRow[]) {
      const list = usageBySession.get(row.session_id);
      if (list) list.push(row);
      else usageBySession.set(row.session_id, [row]);
    }

    const messageAgg = new Map<string, HermesDbMessageAgg>();
    for (const row of db.prepare(
      `SELECT session_id,
              COUNT(*) FILTER (WHERE role = 'user') AS user_turns,
              (SELECT content FROM messages m2
                WHERE m2.session_id = m.session_id AND m2.role = 'user' AND m2.content IS NOT NULL AND m2.content != ''
                ORDER BY m2.id LIMIT 1) AS first_prompt
       FROM messages m GROUP BY session_id`,
    ).all() as HermesDbMessageAgg[]) {
      messageAgg.set(row.session_id, { session_id: row.session_id, user_turns: Number(row.user_turns) || 0, first_prompt: previewText(row.first_prompt) });
    }

    // Per-session tool-name mix (feeds Live's "Tool reliability" panel). The
    // sessions.tool_call_count column proves VOLUME but not the NAME distribution —
    // without this the panel header said "16k tool calls" while the panel body
    // said "No tool calls found."
    const toolMixBySession = new Map<string, { name: string; calls: number; errors: number }[]>();
    for (const row of db.prepare(
      `SELECT session_id, tool_name, COUNT(*) AS calls,
              SUM(CASE WHEN LOWER(SUBSTR(TRIM(COALESCE(content,'')),1,24)) LIKE 'error%'
                       OR INSTR(SUBSTR(COALESCE(content,''),1,400), '"status":"error"') > 0
                       OR INSTR(SUBSTR(COALESCE(content,''),1,400), '"status": "error"') > 0
                  THEN 1 ELSE 0 END) AS errs
       FROM messages
       WHERE role = 'tool' AND tool_name IS NOT NULL AND tool_name != ''
       GROUP BY session_id, tool_name
       ORDER BY calls DESC`,
    ).all() as { session_id: string; tool_name: string; calls: number; errs: number }[]) {
      let list = toolMixBySession.get(row.session_id);
      if (!list) { list = []; toolMixBySession.set(row.session_id, list); }
      if (list.length < 8) list.push({ name: row.tool_name, calls: Number(row.calls) || 0, errors: Number(row.errs) || 0 });
    }

    const rows = db.prepare(
      `SELECT id, parent_session_id, model, started_at, ended_at, last_activity_at,
              message_count, tool_call_count, cwd, title, display_name, archived, hidden, source
       FROM sessions WHERE hidden = 0`,
    ).all() as HermesDbSessionRow[];

    for (const row of rows) {
      const startIso = isoFromEpochSeconds(row.started_at);
      if (!startIso) continue;
      const endSeconds = row.ended_at ?? row.last_activity_at ?? row.started_at;
      const endIso = isoFromEpochSeconds(endSeconds) ?? startIso;
      const agg = messageAgg.get(row.id);

      const records: string[] = [];
      records.push(JSON.stringify({
        type: "system",
        session_id: row.id,
        timestamp: startIso,
        cwd: projectName(row.cwd),
        messageCount: Number(row.message_count) || 0,
        turnCount: agg?.user_turns ?? 0,
        // Provenance: which Hermes surface produced the session (desktop/tui/cli).
        userType: row.source ?? undefined,
        entrypoint: row.source ?? undefined,
      }));
      const title = row.display_name || row.title;
      if (title) records.push(JSON.stringify({ type: "custom-title", customTitle: title }));
      if (agg?.first_prompt) records.push(JSON.stringify({ type: "last-prompt", lastPrompt: agg.first_prompt }));

      // One assistant record per model keeps per-model token attribution exact.
      const usageRows = usageBySession.get(row.id) ?? (row.model ? [{
        session_id: row.id,
        model: row.model,
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      }] : []);
      for (const u of usageRows) {
        records.push(JSON.stringify({
          type: "assistant",
          timestamp: endIso,
          message: {
            role: "assistant",
            model: u.model,
            content: [],
            usage: {
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_read_input_tokens: u.cache_read_tokens,
              cache_creation_input_tokens: u.cache_write_tokens,
            },
          },
        }));
      }
      records.push(JSON.stringify({
        type: "system",
        timestamp: endIso,
        durationMs: Math.max(0, (endSeconds - row.started_at) * 1000),
      }));

      const session = parseLiveSession(file, records, 0, projectName(row.cwd), row.started_at * 1000, undefined, undefined, false);
      if (!session) continue;
      // Tool calls live only as a per-session DB count (no per-model split);
      // surface the real count rather than the record-derived zero.
      const toolCalls = Number(row.tool_call_count) || 0;
      const toolMix = toolMixBySession.get(row.id) ?? [];
      const enriched: LiveSession = toolCalls > 0 ? {
        ...session,
        toolCalls,
        toolCallsPerTurn: session.numTurns > 0 ? toolCalls / session.numTurns : 0,
        toolSummaries: toolMix.map((t) => ({ name: t.name, calls: t.calls, errors: t.errors })),
      } : { ...session };
      if (row.parent_session_id) {
        enriched.isSubagent = true;
        enriched.parentSessionId = row.parent_session_id;
      }
      sessions.push(enriched);
    }
  } catch {
    // Schema drift or a locked DB: report nothing rather than wrong numbers.
    db.close();
    return [];
  } finally {
    try { db.close(); } catch { /* already closed above */ }
  }

  sessions.sort((a, b) => b.startedAt - a.startedAt || a.sessionId.localeCompare(b.sessionId));
  if (dbMemo.size > 8) {
    const oldest = dbMemo.keys().next().value;
    if (oldest !== undefined && oldest !== file) dbMemo.delete(oldest);
  }
  dbMemo.set(file, { dbMtimeMs: st.mtimeMs, dbSize: st.size, walMtimeMs: wal.mtimeMs, walSize: wal.size, probe, sessions });
  return sessions;
}

/** Drop every DB memo entry (test seam; production scans self-invalidate). */
export function clearHermesDbMemoForTests(): void {
  dbMemo.clear();
}

/**
 * Every state.db under a hermes-sqlite source expands to sessions, deduped by
 * session id (a profile DB may repeat the default ledger after migrations).
 * The newest copy of an id wins; output stays newest-first.
 */
export function parseHermesDbSource(files: Array<{ file: string; mtime: number; size: number }>): LiveSession[] {
  const byId = new Map<string, LiveSession>();
  for (const entry of files) {
    for (const session of parseHermesDbSessions(entry.file, entry.mtime, { mtimeMs: entry.mtime, size: entry.size })) {
      const previous = byId.get(session.sessionId);
      if (!previous || session.lastEventAt > previous.lastEventAt) byId.set(session.sessionId, session);
    }
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt || a.sessionId.localeCompare(b.sessionId));
}

/**
 * Full-detail rebuild for one DB session: the memoized ledger summary (exact
 * usage, turns, duration, provenance) merged with message-row evidence (tool
 * summaries, durations, file activity, thinking/text counts, trace graph)
 * parsed through the same record pipeline as every other format. Message rows
 * carry no usage, so ledger fields always win; the message parse only fills
 * evidence the summary cannot know. Returns null when the session id is not
 * in this DB.
 */
export function resolveHermesDbSessionDetail(file: string, sessionId: string, projectDir: string): LiveSession | null {
  const sessions = parseHermesDbSessions(file, Date.now());
  const summary = sessions.find((s) => s.sessionId === sessionId);
  if (!summary) return null;
  const records = hermesDbMessagesToRecords(file, sessionId);
  if (records.length === 0) return summary;
  const detail = parseLiveSession(file, records, 0, projectDir, summary.startedAt, undefined, undefined, false);
  if (!detail) return summary;
  return {
    ...detail,
    // Ledger-exact overlays — message rows have no usage or wall-clock span.
    sessionId: summary.sessionId,
    isSubagent: summary.isSubagent,
    parentSessionId: summary.parentSessionId,
    agentLabel: summary.agentLabel,
    displayTitle: summary.displayTitle,
    lastPromptPreview: summary.lastPromptPreview ?? detail.lastPromptPreview,
    project: summary.project,
    model: summary.model ?? detail.model,
    startedAt: summary.startedAt,
    lastEventAt: summary.lastEventAt,
    durationMs: summary.durationMs,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cacheReadTokens: summary.cacheReadTokens,
    cacheCreateTokens: summary.cacheCreateTokens,
    totalTokens: summary.totalTokens,
    costUsd: summary.costUsd,
    modelUsage: summary.modelUsage,
    usageSegments: summary.usageSegments,
    numTurns: summary.numTurns,
    toolCalls: summary.toolCalls || detail.toolCalls,
    toolErrors: detail.toolErrors,
    toolCallsPerTurn: summary.toolCalls > 0 && summary.numTurns > 0 ? summary.toolCalls / summary.numTurns : detail.toolCallsPerTurn,
    userType: summary.userType,
    metricSources: summary.metricSources,
    path: summary.path,
  };
}

const HERMES_DB_MESSAGE_CAP = 20_000;
const HERMES_DB_CONTENT_CAP = 8_000;

function boundedText(raw: unknown): string {
  const text = textOf(raw);
  return text.length > HERMES_DB_CONTENT_CAP ? `${text.slice(0, HERMES_DB_CONTENT_CAP)}…` : text;
}

function looksLikeToolError(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const text = raw.trimStart();
  if (/^error/i.test(text.slice(0, 24))) return true;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && (parsed as { status?: unknown }).status === "error") return true;
  } catch {
    // plain text — prefix check above is the whole answer
  }
  return false;
}

/**
 * Project one Hermes DB session's message rows into the Claude-style records
 * the shared transcript pipeline already renders. This is what makes DB-backed
 * sessions openable in the Live drawer and the Collection transcript viewer —
 * the summary path intentionally stays summary-only.
 *
 * Bounded: at most HERMES_DB_MESSAGE_CAP rows and HERMES_DB_CONTENT_CAP chars
 * per message body; compaction placeholders and hidden rows are excluded.
 * Returns [] when the session has no readable messages (caller renders an
 * explicit "no transcript" state rather than an empty success).
 */
export function hermesDbMessagesToRecords(file: string, sessionId: string): string[] {
  if (!sessionId || sessionId.length > 512) return [];
  const db = readDb(file);
  if (!db) return [];
  try {
    // SELECT only universally-present columns; optional hygiene columns are
    // filtered via a dynamically-built WHERE from PRAGMA table_info.
    const cols = messagesColumns(db);
    const where: string[] = [];
    if (cols.has("active")) where.push("active = 1");
    if (cols.has("_compressed_summary")) where.push("_compressed_summary = 0");
    if (cols.has("display_kind")) where.push("(display_kind IS NULL OR display_kind != 'hidden')");
    const reasoningSelect = cols.has("reasoning") ? "reasoning" : "NULL";
    const reasoningContentSelect = cols.has("reasoning_content") ? "reasoning_content" : "NULL";
    const rows = db.prepare(
      `SELECT id, role, content, tool_calls, tool_call_id, tool_name, timestamp,
              ${reasoningSelect} AS reasoning, ${reasoningContentSelect} AS reasoning_content
       FROM messages WHERE session_id = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}
       ORDER BY timestamp, id LIMIT ?`,
    ).all(sessionId, HERMES_DB_MESSAGE_CAP + 1) as HermesDbMessageRow[];
    if (rows.length === 0) return [];

    const records: string[] = [];
    for (const row of rows.slice(0, HERMES_DB_MESSAGE_CAP)) {
      const timestamp = isoFromEpochSeconds(row.timestamp);
      const base = timestamp ? { timestamp } : {};
      if (row.role === "user") {
        records.push(JSON.stringify({ type: "user", ...base, message: { role: "user", content: boundedText(row.content) } }));
      } else if (row.role === "assistant") {
        const content: unknown[] = [];
        const thinking = boundedText(row.reasoning ?? row.reasoning_content ?? "");
        if (thinking) content.push({ type: "thinking", thinking });
        const text = boundedText(row.content);
        if (text) content.push({ type: "text", text });
        let calls: unknown[] | null = null;
        try {
          const parsed = JSON.parse(String(row.tool_calls ?? ""));
          if (Array.isArray(parsed)) calls = parsed;
        } catch {
          calls = null;
        }
        for (const tc of calls ?? []) {
          // tool_calls is untrusted JSON: a null/primitive element must skip this
          // tool_use, not throw and discard the entire session's transcript.
          if (!tc || typeof tc !== "object") continue;
          const fn = (tc as { function?: { name?: unknown; arguments?: unknown } }).function ?? (tc as { name?: unknown; arguments?: unknown });
          content.push({
            type: "tool_use",
            id: typeof (tc as { id?: unknown }).id === "string" ? (tc as { id: string }).id
              : typeof (tc as { call_id?: unknown }).call_id === "string" ? (tc as { call_id: string }).call_id
              : `${row.id}`,
            name: typeof fn?.name === "string" && fn.name ? fn.name : row.tool_name ?? "(unknown)",
            input: parseArgs(fn?.arguments),
          });
        }
        records.push(JSON.stringify({ type: "assistant", ...base, message: { role: "assistant", content } }));
      } else if (row.role === "tool") {
        const rawContent = row.content ?? "";
        records.push(JSON.stringify({
          type: "user",
          ...base,
          message: {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: typeof row.tool_call_id === "string" && row.tool_call_id ? row.tool_call_id : `${row.id - 1}`,
              content: boundedText(rawContent),
              is_error: looksLikeToolError(rawContent),
            }],
          },
        }));
      }
      // role === "system" rows are Hermes bookkeeping, not conversation turns.
    }
    if (rows.length > HERMES_DB_MESSAGE_CAP) {
      records.push(JSON.stringify({
        type: "system",
        timestamp: isoFromEpochSeconds(rows[HERMES_DB_MESSAGE_CAP].timestamp) ?? undefined,
        content: `Hermes transcript truncated at ${HERMES_DB_MESSAGE_CAP} messages`,
      }));
    }
    return records;
  } catch {
    return [];
  } finally {
    db.close();
  }
}
