import { getAdapter } from "../adapters/registry";
import { resolveDefaultModel } from "../models";
import { estimateCostUsd, isPlaceholderModel } from "../pricing";
import { emit, type Runner } from "./parse";
import { isCompleteResult, spawnHarnessProcess } from "./spawn";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

export class HeadlessRunner implements Runner {
  kind = "headless" as const;

  async run(ctx: RunnerContext): Promise<RunnerResult> {
    const startedAt = Date.now();
    emit(ctx, { kind: "started", at: startedAt });
    const adapter = getAdapter(ctx.harness);
    const fallbackModel = ctx.model ?? resolveDefaultModel(adapter.id).id ?? null;

    const { acc, stderr, exitCode, durationMs, timedOut, aborted } = await spawnHarnessProcess(ctx, (line, accumulator) => {
      for (const ev of adapter.parseLine(line, accumulator)) emit(ctx, ev);
    });

    // A seeded partial result (init line only, endedAt null) is not completion:
    // a harness that crashed/hung mid-case must resolve through failure().
    if (isCompleteResult(acc.result)) {
      emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });
      const parsed = { ...acc.result, exitCode, durationMs, startedAt, endedAt: startedAt + durationMs } as RunnerResult;
      return normalizeParsedResult(parsed, fallbackModel);
    }
    return normalizeParsedResult(
      failure(ctx, acc, startedAt, durationMs, exitCode, stderr, timedOut, aborted),
      fallbackModel,
    );
  }
}

/** Ground parser gaps in the exact model requested by the run. */
export function normalizeParsedResult(
  result: RunnerResult,
  fallbackModel: string | null | undefined,
): RunnerResult {
  const normalizeModel = (value: string | null | undefined): string | null => {
    const model = value?.trim();
    if (!model || isPlaceholderModel(model)) return null;
    return model;
  };
  const model = normalizeModel(result.model) ?? normalizeModel(fallbackModel);
  if (result.usage.costSource === "measured" || result.usage.costSource === "inferred") {
    return { ...result, model };
  }
  // A bare numeric value has no trustworthy provenance. Discard it before
  // reconstructing an API-equivalent estimate from token classes; never
  // silently relabel an unannotated number as measured spend.
  const usage = { ...result.usage, costUsd: 0, costSource: "missing" as const };
  const estimate = estimateCostUsd(model, {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheCreate: usage.cacheCreateTokens,
  });
  if (estimate == null) return { ...result, model, usage };
  return { ...result, model, usage: { ...usage, costUsd: estimate, costSource: "inferred" } };
}

function failure(
  ctx: RunnerContext,
  acc: { startedAt: number; transcript: TranscriptEntry[]; toolCalls: RunnerResult["toolCalls"]; finalText: string; result: Partial<RunnerResult> | null },
  startedAt: number,
  durationMs: number,
  exitCode: number,
  stderr: string,
  timedOut = false,
  aborted = false,
): RunnerResult {
  emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });
  const msg = aborted
    ? `Runner cancelled after ${durationMs}ms (SIGKILL to the process group) without producing a result event.\nstderr:\n${stderr}`
    : timedOut
    ? `Runner timed out after ${durationMs}ms (SIGKILL) without producing a result event.\nstderr:\n${stderr}`
    : `Runner exited without producing a result event.\nstderr:\n${stderr}`;
  return {
    exitCode,
    durationMs,
    startedAt,
    endedAt: Date.now(),
    transcript: acc.transcript,
    toolCalls: acc.toolCalls,
    // finalText carries only text the agent actually produced. The diagnostic
    // lives in resultText, and graders skip resultText on error runs — stderr
    // matching a final_text regex must never count as a pass.
    finalText: acc.finalText,
    resultText: msg,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
    stopReason: null,
    sessionId: acc.result?.sessionId ?? null,
    model: acc.result?.model ?? null,
    isError: true,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
  };
}
