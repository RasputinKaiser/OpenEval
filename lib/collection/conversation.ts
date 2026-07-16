import fs from "node:fs";
import path from "node:path";
import { hermesJsonToRecords } from "../adapters/hermes";
import { readFileLines } from "../live";

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

const HERMES_MAX_BYTES = 32 * 1024 * 1024;

function contentText(content: unknown, dropAngleBlocks = false): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter((text) => text && !(dropAngleBlocks && text.trimStart().startsWith("<")))
    .join(" ");
}

function messagesFromRecord(obj: Record<string, unknown>): ConversationMessage[] {
  if ((obj as { isSidechain?: boolean }).isSidechain) return [];
  const type = obj.type;
  const message = obj.message as { content?: unknown } | undefined;

  if (type === "user" && message && !(obj as { isMeta?: boolean }).isMeta) {
    const text = contentText(message.content, true).trim();
    return text && !text.startsWith("<") ? [{ role: "user", text }] : [];
  }
  if (type === "assistant" && message) {
    const text = contentText(message.content).trim();
    return text ? [{ role: "assistant", text }] : [];
  }
  if (type === "event_msg") {
    const payload = obj.payload as { type?: string; message?: unknown } | undefined;
    const text = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (payload?.type === "user_message" && text) return [{ role: "user", text }];
    if (payload?.type === "agent_message" && text) return [{ role: "assistant", text }];
    return [];
  }
  if (type === "response_item") {
    const payload = obj.payload as { type?: string; role?: string; content?: unknown } | undefined;
    if (payload?.type !== "message") return [];
    const text = contentText(payload.content, payload.role === "user").trim();
    if (!text) return [];
    if (payload.role === "user") return [{ role: "user", text }];
    if (payload.role === "assistant") return [{ role: "assistant", text }];
    return [];
  }
  if (type === "user_msg" || type === "user_message") {
    const payload = obj.payload as { message?: unknown; text?: unknown } | undefined;
    const raw = payload?.message ?? payload?.text ?? obj.message ?? obj.text;
    const text = typeof raw === "string" ? raw.trim() : "";
    return text ? [{ role: "user", text }] : [];
  }
  return [];
}

function hermesRecords(file: string): string[] {
  const stat = fs.statSync(file);
  if (stat.size > HERMES_MAX_BYTES) return [];
  let raw = "";
  for (const line of readFileLines(file)) raw += line + "\n";
  return hermesJsonToRecords(raw);
}

/** Stream normalized user/assistant prose across supported transcript formats. */
export function* readConversationMessages(file: string): Generator<ConversationMessage> {
  const records: Iterable<string> = path.extname(file).toLowerCase() === ".json"
    ? hermesRecords(file)
    : readFileLines(file);
  const recent: ConversationMessage[] = [];

  for (const line of records) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { continue; }
    for (const message of messagesFromRecord(obj)) {
      // New Codex rollouts echo the same turn as event_msg + response_item.
      // Suppress only nearby protocol echoes; a genuinely repeated prompt much
      // later in the session remains meaningful evidence.
      if (recent.some((seen) => seen.role === message.role && seen.text === message.text)) continue;
      yield message;
      recent.push(message);
      if (recent.length > 4) recent.shift();
    }
  }
}
