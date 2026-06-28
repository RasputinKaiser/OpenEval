import { NCODE_BIN } from "../config";
import type { PermissionMode, RunnerContext, RunnerEvent } from "../types";
import type { BuiltCommand, HarnessAdapter, ParseAccumulator } from "./types";

const ALL_PERMISSION_MODES: PermissionMode[] = [
  "bypassPermissions", "default", "acceptEdits", "dontAsk", "plan", "auto",
];

function buildStreamJsonCommand(ctx: RunnerContext, bin: string, extraEnv: Record<string, string>): BuiltCommand {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "text",
    "--permission-mode", ctx.permissionMode,
    "--add-dir", ctx.workdir,
  ];
  if (ctx.model) args.push("--model", ctx.model);
  if (ctx.maxTurns > 0) args.push("--max-turns", String(ctx.maxTurns));
  args.push(...ctx.extraArgs);
  args.push(ctx.prompt);
  return { bin, args, env: extraEnv };
}

export function parseStreamLine(
  line: string,
  into: ParseAccumulator,
): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  if (!line.trim()) return events;
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return events;
  }
  const at = Date.now();

  if (obj.type === "system" && obj.subtype === "init") {
    into.result = {
      ...(into.result || {}),
      exitCode: 0,
      durationMs: 0,
      startedAt: into.startedAt,
      endedAt: null,
      transcript: into.transcript,
      toolCalls: into.toolCalls,
      finalText: "",
      resultText: "",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
      numTurns: 0,
      stopReason: null,
      sessionId: obj.session_id ?? null,
      model: obj.model ?? null,
      isError: false,
      rawJson: null,
      tokenSegments: [],
      toolCallCounts: {},
    };
    return events;
  }

  if (obj.type === "assistant" && obj.message) {
    const blocks = (obj.message.content || []).map((b: any) => {
      if (b.type === "text") return { type: "text", text: b.text ?? "" };
      if (b.type === "tool_use") {
        const tu = { type: "tool_use", id: b.id, name: b.name, input: b.input };
        const toolStartMap = (into as any)._toolStartMap || ((into as any)._toolStartMap = {});
        toolStartMap[b.id] = at;
        into.toolCalls.push({ id: b.id, name: b.name, input: b.input, atMs: at });
        events.push({ kind: "tool_use", tool: b.name, input: b.input, id: b.id, at });
        return tu;
      }
      if (b.type === "tool_result") return {
        type: "tool_result",
        tool_use_id: b.tool_use_id,
        content: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
        is_error: !!b.is_error,
      };
      return b;
    });
    const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const entry = { role: "assistant" as const, content: blocks, uuid: obj.uuid, atMs: at, textLen: text.length };
    into.transcript.push(entry);
    if (text) {
      into.finalText = text;
      events.push({ kind: "message", message: entry, at });
    }
    return events;
  }

  if (obj.type === "user" && Array.isArray(obj.message?.content)) {
    const toolStartMap = (into as any)._toolStartMap || ((into as any)._toolStartMap = {});
    const blocks = obj.message.content.map((b: any) => {
      if (b.type === "tool_result") {
        const content = typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((c: any) => c?.text ?? "").join("")
            : JSON.stringify(b.content ?? "");
        const tc = into.toolCalls.find((t) => t.id === b.tool_use_id);
        if (tc) {
          tc.output = content;
          tc.isError = !!b.is_error;
          const started = toolStartMap[b.tool_use_id];
          if (started !== undefined) tc.durationMs = Math.max(0, at - started);
        }
        events.push({ kind: "tool_result", id: b.tool_use_id, output: content, isError: !!b.is_error, at });
        return { type: "tool_result", tool_use_id: b.tool_use_id, content, is_error: !!b.is_error };
      }
      return b;
    });
    into.transcript.push({ role: "user" as const, content: blocks, uuid: obj.uuid, atMs: at });
    return events;
  }

  if (obj.type === "result") {
    const usage = obj.usage || {};
    const toolCallCounts: Record<string, number> = {};
    for (const tc of into.toolCalls) toolCallCounts[tc.name] = (toolCallCounts[tc.name] || 0) + 1;
    const segs: any[] = [];
    const finalDur = (obj.duration_ms ?? 0) || 1;
    const totalOut = usage.output_tokens ?? 0;
    const totalIn = usage.input_tokens ?? 0;
    const cumulativeBy = (into.transcript.filter((m) => m.role === "assistant")).length;
    if (cumulativeBy > 1) {
      const outStep = Math.floor(totalOut / Math.max(cumulativeBy, 1));
      const inStep = Math.floor(totalIn / Math.max(cumulativeBy, 1));
      let tIdx = 0;
      for (const m of into.transcript) {
        if (m.role !== "assistant") continue;
        tIdx++;
        const elapsedFromPrev = 1;
        segs.push({
          atMs: m.atMs ?? into.startedAt,
          cumulativeInput: inStep * tIdx,
          cumulativeOutput: outStep * tIdx,
          deltaOutput: outStep,
          deltaInput: inStep,
          outTokPerSec: outStep / elapsedFromPrev,
        });
      }
    } else if (totalOut > 0) {
      segs.push({ atMs: into.startedAt, cumulativeInput: totalIn, cumulativeOutput: totalOut, deltaOutput: totalOut, deltaInput: totalIn, outTokPerSec: totalOut / (finalDur / 1000) });
    }
    into.result = {
      ...(into.result || {}),
      exitCode: obj.is_error ? 1 : 0,
      durationMs: obj.duration_ms ?? 0,
      startedAt: into.startedAt,
      endedAt: into.startedAt + (obj.duration_ms ?? 0),
      transcript: into.transcript,
      toolCalls: into.toolCalls,
      finalText: into.finalText,
      resultText: typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? ""),
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
        costUsd: obj.total_cost_usd ?? 0,
      },
      numTurns: obj.num_turns ?? 0,
      stopReason: obj.stop_reason ?? null,
      sessionId: into.result?.sessionId ?? obj.session_id ?? null,
      model: into.result?.model ?? null,
      isError: !!obj.is_error,
      rawJson: obj,
      tokenSegments: segs,
      toolCallCounts,
    };
    return events;
  }

  return events;
}

export interface StreamJsonAdapterOpts {
  id: string;
  label: string;
  binNames: string[];
  defaultBin: string;
  extraEnv?: Record<string, string>;
  wellKnownPaths?: string[];
}

export function makeStreamJsonAdapter(opts: StreamJsonAdapterOpts): HarnessAdapter {
  return {
    id: opts.id,
    label: opts.label,
    binNames: opts.binNames,
    defaultBin: opts.defaultBin,
    wellKnownPaths: opts.wellKnownPaths,
    versionArgs: ["--version"],
    capabilities: {
      outputFormat: "stream-json",
      reportsCost: true,
      reportsTokens: true,
      reportsTurns: true,
      permissionModes: ALL_PERMISSION_MODES,
      supportsVisionInput: true,
    },
    buildCommand(ctx) {
      return buildStreamJsonCommand(ctx, opts.defaultBin, opts.extraEnv ?? {});
    },
    parseLine(line, acc) {
      return parseStreamLine(line, acc);
    },
  };
}

export const ncodeAdapter = makeStreamJsonAdapter({
  id: "ncode",
  label: "Noumena Code (ncode)",
  binNames: ["ncode"],
  defaultBin: NCODE_BIN,
  extraEnv: { NCODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  wellKnownPaths: ["~/.local/bin/ncode", "~/.ncode/bin/ncode"],
});

export const claudeCodeAdapter = makeStreamJsonAdapter({
  id: "claude-code",
  label: "Claude Code",
  binNames: ["claude"],
  defaultBin: process.env.CLAUDE_BIN || "claude",
  wellKnownPaths: ["~/.local/bin/claude", "~/.claude/local/claude"],
});
