import fs from "node:fs";
import path from "node:path";
import { hermesJsonToRecords } from "../adapters/hermes";
import { readFileLines, stripIdeContextWrapper } from "../live";

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

type ConversationRecordMessage = ConversationMessage & {
  source: "native" | "event_msg" | "response_item" | "legacy";
};

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

function normalizeUserText(text: string): string {
  return stripIdeContextWrapper(text).trim();
}

function messagesFromRecord(obj: Record<string, unknown>): ConversationRecordMessage[] {
  if ((obj as { isSidechain?: boolean }).isSidechain) return [];
  const type = obj.type;
  const message = obj.message as { content?: unknown } | undefined;

  if (type === "user" && message && !(obj as { isMeta?: boolean }).isMeta) {
    const text = normalizeUserText(contentText(message.content, true));
    return text && !text.startsWith("<") ? [{ role: "user", text, source: "native" }] : [];
  }
  if (type === "assistant" && message) {
    const text = contentText(message.content).trim();
    return text ? [{ role: "assistant", text, source: "native" }] : [];
  }
  if (type === "event_msg") {
    const payload = obj.payload as { type?: string; message?: unknown } | undefined;
    const text = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (payload?.type === "user_message" && text) return [{ role: "user", text: normalizeUserText(text), source: "event_msg" }];
    if (payload?.type === "agent_message" && text) return [{ role: "assistant", text, source: "event_msg" }];
    return [];
  }
  if (type === "response_item") {
    const payload = obj.payload as { type?: string; role?: string; content?: unknown } | undefined;
    if (payload?.type !== "message") return [];
    const rawText = contentText(payload.content, payload.role === "user").trim();
    const text = payload.role === "user" ? normalizeUserText(rawText) : rawText;
    if (!text) return [];
    if (payload.role === "user") return [{ role: "user", text, source: "response_item" }];
    if (payload.role === "assistant") return [{ role: "assistant", text, source: "response_item" }];
    return [];
  }
  if (type === "user_msg" || type === "user_message") {
    const payload = obj.payload as { message?: unknown; text?: unknown } | undefined;
    const raw = payload?.message ?? payload?.text ?? obj.message ?? obj.text;
    const text = typeof raw === "string" ? normalizeUserText(raw) : "";
    return text ? [{ role: "user", text, source: "legacy" }] : [];
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
  let previous: ConversationRecordMessage | null = null;

  for (const line of records) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { continue; }
    for (const message of messagesFromRecord(obj)) {
      // New Codex rollouts echo a turn as an adjacent event_msg/response_item
      // pair. Source-aware suppression keeps that protocol duplicate out while
      // preserving genuinely repeated prompts, even when they occur nearby.
      const isProtocolPair = previous && (
        (previous.source === "event_msg" && message.source === "response_item") ||
        (previous.source === "response_item" && message.source === "event_msg")
      );
      if (previous && isProtocolPair && previous.role === message.role && previous.text === message.text) {
        previous = message;
        continue;
      }
      yield { role: message.role, text: message.text };
      previous = message;
    }
  }
}
