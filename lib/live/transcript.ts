import fs from "node:fs";
import path from "node:path";
import { hermesJsonToRecords } from "../adapters/hermes";
import type { LiveTraceFormat, LiveTranscriptTurn, TranscriptResult } from "./types";
import { NON_WS_RE, codexToolOutputError, jsonPreview, parseTimestamp, readFileLines } from "./util";

const TRANSCRIPT_TURN_CAP = 20_000;

const HERMES_TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024;

function parseTranscriptRecords(records: Iterable<string>): TranscriptResult {
  const turns: LiveTranscriptTurn[] = [];
  let index = 0;
  for (const line of records) {
    if (!NON_WS_RE.test(line)) continue;
    index++;
    try {
      turns.push(toTranscriptTurn(JSON.parse(line), index));
    } catch {
      turns.push({
        type: "malformed",
        severity: "warning",
        label: `Malformed line ${index}`,
        preview: line.slice(0, 420),
      });
    }
    if (turns.length >= TRANSCRIPT_TURN_CAP) {
      turns.push({
        type: "truncated",
        severity: "info",
        label: `Transcript truncated at ${TRANSCRIPT_TURN_CAP} lines`,
        preview: "This session is very large; earlier lines are shown.",
      });
      break;
    }
  }
  return { turns };
}

export function parseSessionTranscript(filePath: string, format?: LiveTraceFormat): TranscriptResult {
  try {
    const isHermes = format === "hermes-json" || path.extname(filePath).toLowerCase() === ".json";
    if (isHermes) {
      const stat = fs.statSync(filePath);
      if (stat.size > HERMES_TRANSCRIPT_MAX_BYTES) {
        return { turns: [], error: `Hermes transcript exceeds the ${HERMES_TRANSCRIPT_MAX_BYTES / (1024 * 1024)} MiB viewer limit` };
      }
      let raw = "";
      for (const line of readFileLines(filePath)) raw += line + "\n";
      const records = hermesJsonToRecords(raw);
      if (records.length === 0) return { turns: [], error: "Unsupported single-JSON transcript format" };
      return parseTranscriptRecords(records);
    }
    // Stream (don't readFileSync a giant string) and cap turns so a multi-hundred-MB
    // JSONL session can be opened without exhausting memory.
    return parseTranscriptRecords(readFileLines(filePath));
  } catch (e) {
    return { turns: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function isErroringTurn(turn: LiveTranscriptTurn): boolean {
  return turn.severity === "error" || turn.severity === "warning";
}

export function getErroringTurns(filePath: string, format?: LiveTraceFormat): TranscriptResult {
  const parsed = parseSessionTranscript(filePath, format);
  if (parsed.error) return { turns: [], error: parsed.error };
  const keep = new Set<number>();
  parsed.turns.forEach((turn, index) => {
    if (!isErroringTurn(turn)) return;
    keep.add(Math.max(0, index - 1));
    keep.add(index);
    keep.add(Math.min(parsed.turns.length - 1, index + 1));
  });
  return { turns: [...keep].sort((a, b) => a - b).map((index) => parsed.turns[index]) };
}

/** Joined text of an OpenAI/Anthropic-style content array (input_text / output_text / text blocks). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Tool-call arguments as a compact one-liner (parsed when JSON, verbatim otherwise). */
function argsPreview(args: unknown, max = 420): string {
  if (typeof args !== "string") return jsonPreview(args ?? {}, max);
  try { return jsonPreview(JSON.parse(args), max); } catch { return jsonPreview(args, max); }
}

function toTranscriptTurn(obj: any, index: number): LiveTranscriptTurn {
  const type = typeof obj?.type === "string" ? obj.type : "unknown";
  const subtype = typeof obj?.subtype === "string" ? obj.subtype : undefined;
  const at = parseTimestamp(obj?.timestamp) ?? undefined;

  if (type === "session_meta") {
    const sub = obj.payload?.source?.subagent;
    return {
      type,
      subtype,
      severity: "info",
      at,
      role: "meta",
      label: sub ? `Codex session — subagent ${sub.thread_spawn?.agent_nickname ?? ""}`.trim() : "Codex session",
      preview: jsonPreview({
        id: obj.payload?.id ?? obj.payload?.session_id,
        cwd: obj.payload?.cwd,
        originator: obj.payload?.originator,
        cliVersion: obj.payload?.cli_version,
        modelProvider: obj.payload?.model_provider,
        source: obj.payload?.source,
      }),
    };
  }

  if (type === "event_msg") {
    const payload = obj.payload ?? {};
    if (payload.type === "agent_message") {
      return { type, subtype: payload.type, severity: "info", at, role: "assistant", label: "Assistant", preview: jsonPreview(payload.message ?? "") };
    }
    if (payload.type === "user_message") {
      return { type, subtype: payload.type, severity: "info", at, role: "user", label: "You", preview: jsonPreview(payload.message ?? "") };
    }
    // Misc events are quiet meta — EXCEPT genuine failure events (error,
    // stream_error, turn_aborted, turn_failed…), which must stay visible and
    // counted in the viewer's warning tally.
    const failureEvent = /error|abort|fail/i.test(String(payload.type ?? ""));
    return {
      type,
      subtype: payload.type,
      severity: failureEvent ? "warning" : "info",
      at,
      role: "meta",
      label: payload.type === "token_count" ? "Usage" : `Event: ${payload.type ?? index}`,
      preview: jsonPreview(payload.type === "token_count" ? payload.info?.total_token_usage ?? payload.info : payload.message ?? payload),
    };
  }

  if (type === "response_item") {
    const payload = obj.payload ?? {};
    if (payload.type === "message") {
      const role = String(payload.role ?? "");
      const text = contentText(payload.content);
      if (role === "assistant") return { type, subtype: "message", severity: "info", at, role: "assistant", label: "Assistant", preview: jsonPreview(text) };
      if (role === "user") return { type, subtype: "message", severity: "info", at, role: "user", label: "You", preview: jsonPreview(text) };
      // developer/system prompts are plumbing, not conversation
      return { type, subtype: "message", severity: "info", at, role: "meta", label: `${role || "message"} prompt`, preview: jsonPreview(text) };
    }
    if (payload.type === "function_call") {
      return {
        type, subtype: payload.type, severity: "info", at, role: "tool",
        label: `Tool: ${payload.name ?? "(unknown)"}`,
        preview: argsPreview(payload.arguments),
      };
    }
    if (payload.type === "function_call_output") {
      const out = String(payload.output ?? "");
      const errored = codexToolOutputError(out);
      return { type, subtype: payload.type, severity: errored ? "error" : "info", at, role: "tool", label: errored ? "Tool output — error" : "Tool output", preview: jsonPreview(out) };
    }
    if (payload.type === "reasoning") {
      const summary = contentText(payload.summary) || contentText(payload.content);
      return { type, subtype: payload.type, severity: "info", at, role: "assistant", label: "Reasoning", preview: jsonPreview(summary || "(encrypted reasoning)") };
    }
    return { type, subtype: payload.type, severity: "info", at, role: "meta", label: `Response: ${payload.type ?? "item"}`, preview: jsonPreview(payload) };
  }

  if (type === "system") {
    const warnings = Number(obj.hookErrors ?? 0) || 0;
    return {
      type,
      subtype,
      severity: warnings > 0 ? "warning" : "info",
      at,
      role: "meta",
      label: subtype ? `System / ${subtype}` : "System event",
      preview: jsonPreview({ cwd: obj.cwd, sessionId: obj.sessionId ?? obj.session_id, stopReason: obj.stopReason, hookErrors: obj.hookErrors, messageCount: obj.messageCount }),
    };
  }

  if (type === "assistant" && Array.isArray(obj.message?.content)) {
    const tools = obj.message.content.filter((b: any) => b.type === "tool_use");
    const text = obj.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
    const thinkingCount = obj.message.content.filter((b: any) => b.type === "thinking").length;
    if (tools.length) {
      const names = tools.map((b: any) => b.name).filter(Boolean);
      // Keep the assistant's prose — a record often carries intent text AND
      // the tool call, and this is the only turn that text appears in.
      const parts = [text, ...tools.map((b: any) => argsPreview(b.input))].filter(Boolean);
      return {
        type, subtype, severity: "info", at, role: "tool",
        label: `Tool: ${names.join(", ") || "(unknown)"}`,
        preview: parts.join("\n"),
      };
    }
    return {
      type,
      subtype,
      severity: "info",
      at,
      role: "assistant",
      label: thinkingCount && !text ? "Thinking" : "Assistant",
      preview: jsonPreview(text || `(${thinkingCount} thinking block${thinkingCount === 1 ? "" : "s"})`),
    };
  }

  if (type === "user" && obj.message) {
    const c = obj.message.content;
    if (typeof c === "string") {
      return { type, subtype, severity: "info", at, role: "user", label: "You", preview: jsonPreview(c) };
    }
    if (Array.isArray(c)) {
      const results = c.filter((b: any) => b.type === "tool_result");
      if (results.length) {
        const errored = results.some((b: any) => b.is_error);
        return {
          type, subtype, severity: errored ? "error" : "info", at, role: "tool",
          label: errored ? "Tool result — error" : "Tool result",
          preview: jsonPreview(results.map((b: any) => contentText(b.content)).join("\n") || results),
        };
      }
      const text = contentText(c);
      if (text) return { type, subtype, severity: "info", at, role: "user", label: "You", preview: jsonPreview(text) };
      return { type, subtype, severity: "info", at, role: "meta", label: "User event", preview: jsonPreview(c) };
    }
  }

  if (type === "result") {
    return {
      type,
      subtype,
      severity: obj.is_error ? "error" : "info",
      at,
      role: "meta",
      label: obj.is_error ? "Final result error" : "Final result",
      preview: jsonPreview({ stopReason: obj.stop_reason, durationMs: obj.duration_ms, numTurns: obj.num_turns, usage: obj.usage, costUsd: obj.total_cost_usd }),
    };
  }

  return {
    type,
    subtype,
    severity: type === "queue-operation" ? "warning" : "info",
    at,
    role: "meta",
    label: `${type || "Trace"} event ${index}`,
    preview: jsonPreview(obj),
  };
}
