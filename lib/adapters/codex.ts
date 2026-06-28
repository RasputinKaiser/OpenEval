import type { PermissionMode, RunnerContext, RunnerEvent } from "../types";
import type { BuiltCommand, HarnessAdapter, ParseAccumulator } from "./types";

function buildCodexCommand(ctx: RunnerContext, bin: string): BuiltCommand {
  const args = ["exec", "--json", "--skip-git-repo-check"];
  const pm = ctx.permissionMode;
  if (pm === "bypassPermissions") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    const sandbox = pm === "default" ? "read-only" : "workspace-write";
    args.push("-s", sandbox);
  }
  if (ctx.model) args.push("-m", ctx.model);
  args.push(...ctx.extraArgs);
  args.push(ctx.prompt);
  return { bin, args, env: {} };
}

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
    if (item.type === "message") {
      const texts = (item.content || []).filter((c: any) => c.type === "output_text" || c.type === "text").map((c: any) => c.text ?? "");
      const text = texts.join("");
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
    const toolCallCounts: Record<string, number> = {};
    for (const tc of into.toolCalls) toolCallCounts[tc.name] = (toolCallCounts[tc.name] || 0) + 1;
    const durationMs = obj.duration_ms ?? (at - into.startedAt);
    into.result = {
      ...(into.result || {}),
      exitCode: 0, durationMs, startedAt: into.startedAt, endedAt: at,
      transcript: into.transcript, toolCalls: into.toolCalls, finalText: into.finalText,
      resultText: into.finalText,
      usage: {
        inputTokens: usage.input_tokens ?? usage.inputTokens ?? 0,
        outputTokens: usage.output_tokens ?? usage.outputTokens ?? 0,
        cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0,
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
      transcript: into.transcript, toolCalls: into.toolCalls, finalText: into.finalText || msg,
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

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  label: "Codex CLI",
  binNames: ["codex"],
  defaultBin: process.env.CODEX_BIN || "codex",
  wellKnownPaths: ["~/.local/bin/codex", "~/.codex/bin/codex"],
  versionArgs: ["--version"],
  capabilities: {
    outputFormat: "jsonl",
    reportsCost: false,
    reportsTokens: true,
    reportsTurns: true,
    permissionModes: ["bypassPermissions", "default", "acceptEdits", "dontAsk", "plan", "auto"],
    supportsVisionInput: false,
  },
  buildCommand(ctx) {
    return buildCodexCommand(ctx, process.env.CODEX_BIN || "codex");
  },
  parseLine(line, acc) {
    return parseCodexLine(line, acc);
  },
};

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
