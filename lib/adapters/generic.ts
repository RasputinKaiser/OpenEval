import type { BuiltCommand, HarnessAdapter, ParseAccumulator } from "./types";
import type { PermissionMode, RunnerContext, RunnerEvent } from "../types";
import type { FieldMapping, HarnessDescriptorInput, LiveTraceDescriptor, NormalizedDescriptor } from "./schema";
import { parseStreamLine } from "./stream-json";
import { parseCodexLine } from "./codex";

export type { FieldMapping, LiveTraceDescriptor } from "./schema";
/** Raw (pre-validation) descriptor shape, as written in a .harness.json file. */
export type HarnessDescriptor = HarnessDescriptorInput;

export function getPath(obj: any, path: string | undefined): any {
  if (!path || obj == null) return undefined;
  // filter(Boolean) drops the empty leading segment when a mapping starts with
  // an array index (e.g. "[0].text" → ".0.text" → ["", "0", "text"]).
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v) ?? ""; } catch { return String(v); }
}

function maybeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function substitute(token: string, ctx: RunnerContext): string {
  return token
    .replace("{prompt}", ctx.prompt)
    .replace("{workdir}", ctx.workdir)
    .replace("{model}", ctx.model ?? "")
    .replace("{maxTurns}", String(ctx.maxTurns))
    .replace("{permissionMode}", ctx.permissionMode);
}

export function resolveDescriptorBin(desc: NormalizedDescriptor): string {
  if (desc.binEnvVar && process.env[desc.binEnvVar]) return process.env[desc.binEnvVar]!;
  return desc.defaultBin;
}

/**
 * Build the full command line for a descriptor-defined harness.
 *
 * Order: argTemplate → permission args → workdir/model/maxTurns flags →
 * case extra_args → prompt (arg/flag/stdin). Every declared flag is applied —
 * a descriptor never silently drops part of the run context.
 */
export function buildDescriptorCommand(desc: NormalizedDescriptor, ctx: RunnerContext): BuiltCommand {
  const bin = resolveDescriptorBin(desc);
  const args = desc.argTemplate.map((t) => substitute(t, ctx));

  if (desc.permissionArgs) {
    const modeArgs = desc.permissionArgs[ctx.permissionMode] ?? desc.permissionArgs["*"];
    if (modeArgs) args.push(...modeArgs.map((t) => substitute(t, ctx)));
  } else if (desc.permissionFlag) {
    args.push(desc.permissionFlag, ctx.permissionMode);
  }

  if (desc.workdirFlag && !desc.argTemplate.some((t) => t.includes("{workdir}"))) {
    args.push(desc.workdirFlag, ctx.workdir);
  }
  if (desc.modelFlag && ctx.model && !desc.argTemplate.some((t) => t.includes("{model}"))) {
    args.push(desc.modelFlag, ctx.model);
  }
  if (desc.maxTurnsFlag && ctx.maxTurns > 0 && !desc.argTemplate.some((t) => t.includes("{maxTurns}"))) {
    args.push(desc.maxTurnsFlag, String(ctx.maxTurns));
  }
  if (desc.appendExtraArgs) args.push(...ctx.extraArgs);

  let stdin: string | undefined;
  switch (desc.prompt.mode) {
    case "template":
      break;
    case "flag":
      args.push(desc.prompt.flag!, ctx.prompt);
      break;
    case "stdin":
      stdin = ctx.prompt;
      break;
    case "arg":
    default:
      args.push(ctx.prompt);
      break;
  }

  return { bin, args, env: desc.extraEnv, stdin };
}

export function parseGenericJsonlLine(
  line: string,
  into: ParseAccumulator,
  desc: { fields?: FieldMapping; eventFilter?: string }
): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  if (!line.trim()) return events;
  let obj: any;
  try { obj = JSON.parse(line); } catch { return events; }
  const at = Date.now();
  const f = desc.fields ?? {};

  const evtType = desc.eventFilter ? getPath(obj, desc.eventFilter) : obj.type;

  const sessionId = getPath(obj, f.sessionId);
  if (sessionId != null) (into as any)._lastSessionId = sessionId;
  if ((into as any)._lastSessionId != null && into.result) into.result.sessionId = (into as any)._lastSessionId;

  const toolName = getPath(obj, f.toolCallName);
  if (toolName != null) {
    const id = str(getPath(obj, f.toolCallId)) || `tc-${into.toolCalls.length + 1}`;
    let input: unknown = getPath(obj, f.toolCallInput);
    if (typeof input === "string") { try { input = JSON.parse(input); } catch {} }
    into.toolCalls.push({ id, name: str(toolName), input, atMs: at });
    events.push({ kind: "tool_use", tool: str(toolName), input, id, at });
    return events;
  }

  const toolOut = getPath(obj, f.toolCallOutput);
  if (toolOut != null) {
    const id = str(getPath(obj, f.toolCallId)) || into.toolCalls[into.toolCalls.length - 1]?.id || "";
    const output = str(toolOut);
    const tc = into.toolCalls.find((t) => t.id === id);
    if (tc) { tc.output = output; tc.isError = !!getPath(obj, f.toolCallError); }
    events.push({ kind: "tool_result", id, output, isError: !!getPath(obj, f.toolCallError), at });
    return events;
  }

  const finalText = getPath(obj, f.finalText);
  if (finalText != null) {
    const text = str(finalText);
    const entry = { role: "assistant" as const, content: [{ type: "text" as const, text }], uuid: undefined, atMs: at, textLen: text.length };
    into.transcript.push(entry);
    if (text) { into.finalText = text; events.push({ kind: "message", message: entry, at }); }
  }

  const durationMs = getPath(obj, f.durationMs);
  const inputTokens = getPath(obj, f.inputTokens);
  const outputTokens = getPath(obj, f.outputTokens);
  const isError = getPath(obj, f.isError);
  if (durationMs != null || inputTokens != null || outputTokens != null || isError != null || evtType === "result" || evtType === "turn.completed" || evtType === "done") {
    const toolCallCounts: Record<string, number> = {};
    for (const tc of into.toolCalls) toolCallCounts[tc.name] = (toolCallCounts[tc.name] || 0) + 1;
    into.result = {
      ...(into.result || {}),
      exitCode: isError ? 1 : 0,
      durationMs: maybeNum(durationMs) || (at - into.startedAt),
      startedAt: into.startedAt,
      endedAt: at,
      transcript: into.transcript,
      toolCalls: into.toolCalls,
      finalText: into.finalText,
      resultText: into.finalText,
      usage: {
        inputTokens: maybeNum(inputTokens),
        outputTokens: maybeNum(outputTokens),
        cacheReadTokens: maybeNum(getPath(obj, f.cacheReadTokens)),
        cacheCreateTokens: maybeNum(getPath(obj, f.cacheCreateTokens)),
        costUsd: maybeNum(getPath(obj, f.costUsd)),
      },
      numTurns: maybeNum(getPath(obj, f.numTurns)) || into.toolCalls.length,
      stopReason: str(getPath(obj, f.stopReason)) || null,
      sessionId: into.result?.sessionId ?? (into as any)._lastSessionId ?? null,
      model: into.result?.model ?? (str(getPath(obj, f.model)) || null),
      isError: !!isError,
      rawJson: obj,
      tokenSegments: [],
      toolCallCounts,
    };
  }

  return events;
}

function parseTextLine(line: string, acc: ParseAccumulator): RunnerEvent[] {
  if (!line.trim()) return [];
  const text = line;
  const entry = { role: "assistant" as const, content: [{ type: "text" as const, text }], uuid: undefined, atMs: Date.now(), textLen: text.length };
  acc.transcript.push(entry);
  acc.finalText = text;
  return [{ kind: "message" as const, message: entry, at: Date.now() }];
}

export function makeGenericAdapter(desc: NormalizedDescriptor): HarnessAdapter {
  return {
    id: desc.id,
    label: desc.label,
    binNames: desc.binNames,
    defaultBin: resolveDescriptorBin(desc),
    wellKnownPaths: desc.wellKnownPaths,
    versionArgs: desc.versionArgs,
    descriptor: desc,
    capabilities: {
      outputFormat: desc.parser === "claude-stream-json" ? "stream-json" : desc.parser === "text" ? "text" : "jsonl",
      reportsCost: desc.capabilities.reportsCost,
      reportsTokens: desc.capabilities.reportsTokens,
      reportsTurns: desc.capabilities.reportsTurns,
      permissionModes: desc.capabilities.permissionModes as PermissionMode[],
      supportsVisionInput: desc.capabilities.supportsVisionInput,
    },
    buildCommand(ctx: RunnerContext): BuiltCommand {
      return buildDescriptorCommand(desc, ctx);
    },
    parseLine(line: string, acc: ParseAccumulator): RunnerEvent[] {
      switch (desc.parser) {
        case "claude-stream-json":
          return parseStreamLine(line, acc);
        case "codex-jsonl":
          return parseCodexLine(line, acc);
        case "text":
          return parseTextLine(line, acc);
        case "generic-jsonl":
        default:
          return parseGenericJsonlLine(line, acc, desc);
      }
    },
  };
}
