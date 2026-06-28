import { spawn } from "node:child_process";
import { getAdapter } from "../adapters/registry";
import { emit, type Runner } from "./parse";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

export class HeadlessRunner implements Runner {
  kind = "headless" as const;

  async run(ctx: RunnerContext): Promise<RunnerResult> {
    const adapter = getAdapter(ctx.harness);
    const { bin, args, env: extraEnv } = adapter.buildCommand(ctx);

    const startedAt = Date.now();
    emit(ctx, { kind: "started", at: startedAt });

    return new Promise<RunnerResult>((resolve) => {
      const proc = spawn(bin, args, {
        cwd: ctx.workdir,
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      const acc = {
        startedAt,
        transcript: [] as TranscriptEntry[],
        toolCalls: [] as RunnerResult["toolCalls"],
        finalText: "",
        result: null as Partial<RunnerResult> | null,
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutBuf += text;
        emit(ctx, { kind: "log", stream: "stdout", chunk: text, at: Date.now() });
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
          for (const ev of adapter.parseLine(line, acc)) emit(ctx, ev);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuf += text;
        emit(ctx, { kind: "log", stream: "stderr", chunk: text, at: Date.now() });
      });

      const timer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, ctx.timeoutMs);

      proc.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        resolve(failure(ctx, acc, startedAt, {
          exitCode: 2,
          durationMs,
          stderr: stderrBuf,
          error: String(err),
        }));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (stdoutBuf.trim()) {
          for (const ev of adapter.parseLine(stdoutBuf, acc)) emit(ctx, ev);
        }
        const durationMs = Date.now() - startedAt;
        const exitCode = code ?? (acc.result?.isError ? 1 : 0);

        if (acc.result) {
          emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });
          resolve({ ...acc.result, exitCode, durationMs, startedAt, endedAt: startedAt + durationMs } as RunnerResult);
          return;
        }
        resolve(failure(ctx, acc, startedAt, {
          exitCode,
          durationMs,
          stderr: stderrBuf,
        }));
      });
    });
  }
}

function failure(
  ctx: RunnerContext,
  acc: { startedAt: number; transcript: TranscriptEntry[]; toolCalls: RunnerResult["toolCalls"]; finalText: string; result: Partial<RunnerResult> | null },
  startedAt: number,
  info: { exitCode: number; durationMs: number; stderr: string; error?: string }
): RunnerResult {
  emit(ctx, { kind: "finished", at: Date.now(), durationMs: info.durationMs, exitCode: info.exitCode });
  const msg = info.error
    ? `Runner failed to spawn: ${info.error}\n${info.stderr}`
    : `Runner exited without producing a result event.\nstderr:\n${info.stderr}`;
  return {
    exitCode: info.exitCode,
    durationMs: info.durationMs,
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
