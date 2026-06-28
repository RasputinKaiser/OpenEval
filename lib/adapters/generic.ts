import type { BuiltCommand, HarnessAdapter, ParseAccumulator } from "./types";
import type { PermissionMode, RunnerContext, RunnerEvent } from "../types";

export interface FieldMapping {
  finalText?: string;
  sessionId?: string;
  model?: string;
  toolCallName?: string;
  toolCallId?: string;
  toolCallInput?: string;
  toolCallOutput?: string;
  toolCallError?: string;
  durationMs?: string;
  numTurns?: string;
  costUsd?: string;
  inputTokens?: string;
  outputTokens?: string;
  stopReason?: string;
  isError?: string;
}

export type GenericOutputFormat = "jsonl" | "stream-json" | "text";

export interface HarnessDescriptor {
  id: string;
  label: string;
  binNames: string[];
  defaultBin?: string;
  wellKnownPaths?: string[];
  versionArgs?: string[];
  output: GenericOutputFormat;
  argTemplate: string[];
  extraEnv?: Record<string, string>;
  permissionFlag?: string;
  promptPlaceholder?: string;
  workdirFlag?: string;
  modelFlag?: string;
  maxTurnsFlag?: string;
  eventFilter?: string;
  fields: FieldMapping;
}

export function getPath(obj: any, path: string | undefined): any {
  if (!path || obj == null) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
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

function replaceTemplate(template: string[], ctx: RunnerContext, bin: string): { args: string[] } {
  const out: string[] = [];
  for (const tok of template) {
    const replaced = tok
      .replace("{prompt}", ctx.prompt)
      .replace("{workdir}", ctx.workdir)
      .replace("{model}", ctx.model ?? "")
      .replace("{maxTurns}", String(ctx.maxTurns));
    out.push(replaced);
  }
  return { args: out };
}

export function parseGenericJsonlLine(line: string, into: ParseAccumulator, desc: HarnessDescriptor): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  if (!line.trim()) return events;
  let obj: any;
  try { obj = JSON.parse(line); } catch { return events; }
  const at = Date.now();
  const f = desc.fields;

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
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        costUsd: maybeNum(getPath(obj, f.costUsd)),
      },
      numTurns: maybeNum(getPath(obj, f.numTurns)) || into.toolCalls.length,
      stopReason: str(getPath(obj, f.stopReason)) || null,
      sessionId: into.result?.sessionId ?? (into as any)._lastSessionId ?? null,
      model: into.result?.model ?? str(getPath(obj, f.model)) ?? null,
      isError: !!isError,
      rawJson: obj,
      tokenSegments: [],
      toolCallCounts,
    };
  }

  return events;
}

export function makeGenericAdapter(desc: HarnessDescriptor): HarnessAdapter {
  const bin = desc.defaultBin || desc.binNames[0];
  return {
    id: desc.id,
    label: desc.label,
    binNames: desc.binNames,
    defaultBin: bin,
    wellKnownPaths: desc.wellKnownPaths,
    versionArgs: desc.versionArgs ?? ["--version"],
    capabilities: {
      outputFormat: desc.output === "jsonl" ? "jsonl" : desc.output === "stream-json" ? "stream-json" : "text",
      reportsCost: !!desc.fields.costUsd,
      reportsTokens: !!desc.fields.inputTokens || !!desc.fields.outputTokens,
      reportsTurns: !!desc.fields.numTurns,
      permissionModes: ["bypassPermissions", "default", "acceptEdits", "dontAsk", "plan", "auto"],
      supportsVisionInput: false,
    },
    buildCommand(ctx: RunnerContext): BuiltCommand {
      const { args } = replaceTemplate(desc.argTemplate, ctx, bin);
      return { bin, args, env: desc.extraEnv ?? {} };
    },
    parseLine(line: string, acc: ParseAccumulator): RunnerEvent[] {
      if (desc.output === "text") {
        if (!line.trim()) return [];
        const text = line;
        const entry = { role: "assistant" as const, content: [{ type: "text" as const, text }], uuid: undefined, atMs: Date.now(), textLen: text.length };
        acc.transcript.push(entry);
        acc.finalText = text;
        return [{ kind: "message" as const, message: entry, at: Date.now() }];
      }
      return parseGenericJsonlLine(line, acc, desc);
    },
  };
}
