import { getAdapter } from "../adapters/registry";
import { emit, type Runner } from "./parse";
import { spawnHarnessProcess } from "./spawn";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

export class HeadlessRunner implements Runner {
  kind = "headless" as const;

  async run(ctx: RunnerContext): Promise<RunnerResult> {
    const startedAt = Date.now();
    emit(ctx, { kind: "started", at: startedAt });

    const { acc, stderr, exitCode, durationMs } = await spawnHarnessProcess(ctx, (line, accumulator) => {
      const adapter = getAdapter(ctx.harness);
      for (const ev of adapter.parseLine(line, accumulator)) emit(ctx, ev);
    });

    if (acc.result) {
      emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });
      return { ...acc.result, exitCode, durationMs, startedAt, endedAt: startedAt + durationMs } as RunnerResult;
    }
    return failure(ctx, acc, startedAt, durationMs, exitCode, stderr);
  }
}

function failure(
  ctx: RunnerContext,
  acc: { startedAt: number; transcript: TranscriptEntry[]; toolCalls: RunnerResult["toolCalls"]; finalText: string; result: Partial<RunnerResult> | null },
  startedAt: number,
  durationMs: number,
  exitCode: number,
  stderr: string,
): RunnerResult {
  emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });
  const msg = `Runner exited without producing a result event.\nstderr:\n${stderr}`;
  return {
    exitCode,
    durationMs,
    startedAt,
    endedAt: Date.now(),
    transcript: acc.transcript,
    toolCalls: acc.toolCalls,
    finalText: acc.finalText || msg,
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