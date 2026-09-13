import fs from "node:fs";
import path from "node:path";
import type { LiveTraceFormat } from "./types";
import { readFileLines, MAX_JSONL_RECORD_BYTES } from "./util";

type Value = Record<string, any>;
export const isNativeEventFormat = (format?: string) => format === "kimi-wire" || format === "deepseek-jsonl";
const iso = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value).toISOString() : undefined;
const message = (role: string, content: unknown, timestamp?: string, extra: Value = {}) => ({ type: role, timestamp, message: { content: typeof content === "string" ? [{ type: "text", text: content }] : content, ...extra } });

/** Projection of documented wire envelopes. Request mirrors remain metadata. */
export function normalizeNativeEvent(obj: Value, format?: LiveTraceFormat): Value {
  if (format === "kimi-wire") {
    if (obj.type === "metadata") return { type: "system", subtype: "wire_metadata", protocol_version: obj.protocol_version };
    const event = obj.message;
    if (!event || typeof event.type !== "string" || !event.payload) return { type: "unsupported", detail: "Unrecognized Kimi wire envelope" };
    const p = event.payload, at = iso(obj.timestamp * 1000);
    switch (event.type) {
      case "TurnBegin": case "SteerInput": return message("user", typeof p.user_input === "string" ? p.user_input : p.user_input, at);
      case "TextPart": return message("assistant", [{ type: "text", text: p.text ?? "" }], at);
      case "ThinkPart": return message("assistant", [{ type: "thinking", thinking: p.think ?? "" }], at);
      case "ToolCall": return message("assistant", [{ type: "tool_use", id: p.id, name: p.function?.name, input: p.function?.arguments ?? "" }], at);
      case "ToolResult": return message("user", [{ type: "tool_result", tool_use_id: p.tool_call_id, content: p.return_value?.output ?? "", is_error: p.return_value?.is_error === true }], at);
      // StatusUpdate usage is a step snapshot, not an additive event. It is
      // preserved for inspection until per-step accounting is proven.
      default: return { type: "system", subtype: `kimi:${event.type}`, timestamp: at, source_event: p };
    }
  }
  if (format === "deepseek-jsonl") {
    if (obj.type === "session") {
      if (obj.version !== 3) throw new Error(`Unsupported DeepSeek session format ${obj.version}; v3 is supported.`);
      return { type: "system", subtype: "init", sessionId: obj.id, timestamp: iso(obj.createdAt), cwd: obj.cwd, parentSessionId: obj.parentSession, isSubagent: obj.origin === "subagent" };
    }
    const d = obj.data, at = iso(obj.time);
    if (!d || typeof obj.seq !== "number") throw new Error("Unrecognized DeepSeek event envelope.");
    if (obj.type === "user/message") return message("user", d.content, at);
    if (obj.type === "assistant/message") {
      const content = (d.message?.content ?? []).filter((block: Value) => block.type !== "tool-call").map((block: Value) => block.type === "reasoning" ? { type: "thinking", thinking: block.text } : block);
      const u = d.usage;
      return message("assistant", content, at, { id: d.message?.id, model: d.message?.source?.model, provider: d.message?.source?.provider, ...(u ? { usage: { input_tokens: u.inputTokens, output_tokens: u.outputTokens, cache_read_input_tokens: u.cacheReadTokens, cache_creation_input_tokens: u.cacheWriteTokens } } : {}) });
    }
    if (obj.type === "tool/call") return message("assistant", [{ type: "tool_use", id: d.callId, name: d.name, input: d.arguments }], at);
    if (obj.type === "tool/result") return message("user", (d.message?.content ?? []).filter((block: Value) => block.type === "tool-result").map((block: Value) => ({ type: "tool_result", tool_use_id: block.toolCallId, content: block.content, is_error: block.isError === true })), at);
    const known = ["turn/start", "turn/end", "step/start", "step/end", "system/message", "assistant/attempt", "request/header", "request/context", "session/end-seed", "compaction/start", "compaction/summary", "compaction/end"];
    if (!known.includes(obj.type) && obj.ignorable !== true) throw new Error(`Unsupported required DeepSeek event: ${obj.type}`);
    return { type: "system", subtype: `deepseek:${obj.type}`, timestamp: at, source_event: d };
  }
  return obj;
}

export function nativeIdentity(file: string, format: string) {
  if (format !== "kimi-wire") return { sessionId: path.basename(file, path.extname(file)) };
  const agent = path.basename(path.dirname(file));
  const agentLayout = path.basename(path.dirname(path.dirname(file))) === "agents";
  const parent = agentLayout ? path.basename(path.dirname(path.dirname(path.dirname(file)))) : path.basename(path.dirname(file));
  return { sessionId: agentLayout && agent !== "main" ? `${parent}/agent-${agent}` : parent, parentSessionId: agentLayout && agent !== "main" ? parent : null, isSubagent: agentLayout && agent !== "main", agentLabel: agentLayout ? agent : null };
}

/** xai-org/grok-build render_blocks_to_markdown: User / Assistant / Tools. */
export function* grokMarkdownRecords(file: string): Generator<string> {
  if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error("Grok export exceeds the 32 MiB reader limit.");
  let role = "system", buffer: string[] = [], bytes = 0, fence = false;
  const emit = () => JSON.stringify(role === "system" ? { type: "system", subtype: "export_metadata", text: buffer.join("\n") } : message(role, buffer.join("\n")));
  yield JSON.stringify({ type: "system", sessionId: path.basename(file, ".md"), subtype: "init" });
  for (const line of readFileLines(file)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && /^## (User|Assistant|Tools)\s*$/.exec(line);
    if (heading) { if (buffer.length) yield emit(); buffer = []; bytes = 0; role = heading[1] === "User" ? "user" : heading[1] === "Assistant" ? "assistant" : "system"; }
    else { bytes += Buffer.byteLength(line); if (bytes > MAX_JSONL_RECORD_BYTES) throw new Error("Grok export section exceeds the 4 MiB evidence limit."); buffer.push(line); }
  }
  if (buffer.length) yield emit();
}

/** Optional documented state metadata; bounded and never a model-identity source. */
export function kimiSessionMetadata(file: string): { title?: string; warning?: string } {
  const agentLayout = path.basename(path.dirname(path.dirname(file))) === "agents";
  const root = agentLayout ? path.dirname(path.dirname(path.dirname(file))) : path.dirname(file);
  try {
    const stateFile = path.join(root, "state.json");
    if (!fs.existsSync(stateFile)) return {};
    if (fs.statSync(stateFile).size > 1024 * 1024) return { warning: "Kimi state metadata exceeds the 1 MiB limit." };
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.version !== 1) return { warning: "Unsupported Kimi state metadata version; wire evidence remains readable." };
    return typeof state.custom_title === "string" ? { title: state.custom_title } : {};
  } catch { return { warning: "Malformed Kimi state metadata; wire evidence remains readable." }; }
}
