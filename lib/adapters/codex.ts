import type { RunnerEvent } from "../types";
import type { ParseAccumulator } from "./types";

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 };

export function parseCodexLine(line: string, into: ParseAccumulator): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  if (!line.trim()) return events;
  let obj: any;
  try { obj = JSON.parse(line); } catch { return events; }
  const at = Date.now();

  if (obj.type === "thread.started") {
    into.result = {
      ...(into.result || {}),
      exitCode: 0, durationMs: 0, startedAt: into.startedAt, endedAt: null,
      transcript: into.transcript, toolCalls: into.toolCalls, finalText: "", resultText: "",
      usage: { ...EMPTY_USAGE }, numTurns: 0, stopReason: null,
      sessionId: obj.thread_id ?? into.result?.sessionId ?? null,
      model: into.result?.model ?? null, isError: false, rawJson: null,
      tokenSegments: [], toolCallCounts: {},
    };
    return events;
  }

  if (obj.type === "item.completed" && obj.item) {
    const item = obj.item;
    // Older CLIs emit type "message" with a content array; 0.4x+ emits type
    // "agent_message" with a flat text field. Same meaning: assistant text.
    if (item.type === "message" || item.type === "agent_message") {
      const texts = (item.content || []).filter((c: any) => c.type === "output_text" || c.type === "text").map((c: any) => c.text ?? "");
      const text = typeof item.text === "string" && item.text ? item.text : texts.join("");
      const entry = { role: "assistant" as const, content: [{ type: "text" as const, text }], uuid: item.id, atMs: at, textLen: text.length };
      into.transcript.push(entry);
      if (text) {
        into.finalText = text;
        events.push({ kind: "message", message: entry, at });
      }
      return events;
    }
    if (item.type === "function_call") {
      let input: unknown = item.arguments;
      try { input = item.arguments ? JSON.parse(item.arguments) : item.arguments; } catch {}
      into.toolCalls.push({ id: item.call_id ?? item.id, name: item.name, input, atMs: at });
      events.push({ kind: "tool_use", tool: item.name, input, id: item.call_id ?? item.id, at });
      return events;
    }
    if (item.type === "function_call_output") {
      const id = item.call_id ?? item.id;
      const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
      const tc = into.toolCalls.find((t) => t.id === id);
      if (tc) { tc.output = output; tc.isError = !!item.is_error; }
      events.push({ kind: "tool_result", id, output, isError: !!item.is_error, at });
      return events;
    }
    return events;
  }

  if (obj.type === "turn.completed") {
    const usage = obj.usage || {};
    const inclusiveInput = usage.input_tokens ?? usage.inputTokens ?? 0;
    const cachedInput = usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? 0;
    const toolCallCounts: Record<string, number> = {};
    for (const tc of into.toolCalls) toolCallCounts[tc.name] = (toolCallCounts[tc.name] || 0) + 1;
    const durationMs = obj.duration_ms ?? (at - into.startedAt);
    into.result = {
      ...(into.result || {}),
      exitCode: 0, durationMs, startedAt: into.startedAt, endedAt: at,
      transcript: into.transcript, toolCalls: into.toolCalls, finalText: into.finalText,
      resultText: into.finalText,
      usage: {
        // Codex input_tokens includes cached input. Runner telemetry stores
        // mutually exclusive token classes, matching the live parser.
        inputTokens: Math.max(0, inclusiveInput - cachedInput),
        outputTokens: usage.output_tokens ?? usage.outputTokens ?? 0,
        // Codex reports cached input tokens under cached_input_tokens (same field
        // the live-trace parser reads); 0 when absent. Without this, recorded
        // Codex runs always show a 0% cache-hit rate in the summary.
        cacheReadTokens: cachedInput,
        cacheCreateTokens: 0, costUsd: 0, costSource: "missing",
      },
      numTurns: obj.num_turns ?? 1,
      stopReason: obj.stop_reason ?? "completed",
      sessionId: into.result?.sessionId ?? null,
      model: into.result?.model ?? null,
      isError: false, rawJson: obj, tokenSegments: [], toolCallCounts,
    };
    return events;
  }

  if (obj.type === "turn.failed" || obj.type === "error") {
    const msg = obj.error?.message ?? obj.message ?? "codex error";
    into.result = {
      ...(into.result || {}),
      exitCode: 1, durationMs: at - into.startedAt, startedAt: into.startedAt, endedAt: at,
      // Diagnostics belong in resultText. A failed Codex turn with no agent
      // output must not satisfy final_text graders via its error message.
      transcript: into.transcript, toolCalls: into.toolCalls, finalText: into.finalText,
      resultText: msg,
      usage: into.result?.usage ?? { ...EMPTY_USAGE },
      numTurns: into.result?.numTurns ?? 0, stopReason: "error",
      sessionId: into.result?.sessionId ?? null, model: into.result?.model ?? null,
      isError: true, rawJson: obj, tokenSegments: [], toolCallCounts: {},
    };
    return events;
  }

  return events;
}

export const CODEX_SAMPLE_LINES: string[] = [
  '{"type":"thread.started","thread_id":"thread_abc"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"m1","type":"message","role":"assistant","content":[{"type":"output_text","text":"I will fix the bug."}]}}',
  '{"type":"item.completed","item":{"id":"fc1","type":"function_call","name":"shell","call_id":"call_1","arguments":"{\\"command\\":[\\"npm\\",\\"test\\"]}"}}',
  '{"type":"item.completed","item":{"id":"fo1","type":"function_call_output","call_id":"call_1","output":"3 passing"}}',
  '{"type":"turn.completed","duration_ms":1234,"usage":{"input_tokens":120,"output_tokens":40}}',
];

export function runCodexParserSelfCheck(): { ok: boolean; detail: string } {
  const acc: ParseAccumulator = {
    startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null,
  };
  for (const line of CODEX_SAMPLE_LINES) parseCodexLine(line, acc);
  const r = acc.result;
  if (!r) return { ok: false, detail: "no result event produced" };
  const finalOk = acc.finalText === "I will fix the bug.";
  const sessionOk = r.sessionId === "thread_abc";
  const toolOk = acc.toolCalls.length === 1 && acc.toolCalls[0].name === "shell" && acc.toolCalls[0].output === "3 passing";
  const usageOk = r.usage?.inputTokens === 120 && r.usage?.outputTokens === 40;
  const allOk = finalOk && sessionOk && toolOk && usageOk;
  const detail = `final=${finalOk} session=${sessionOk} tool=${toolOk} usage=${usageOk} (finalText="${acc.finalText.slice(0, 40)}", ${acc.toolCalls.length} toolcall(s))`;
  return { ok: allOk, detail };
}
