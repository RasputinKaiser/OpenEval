import { spawn } from "node:child_process";
import { getAdapter } from "../adapters/registry";
import type { ParseAccumulator } from "../adapters/types";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

export interface SpawnHarnessResult {
  acc: ParseAccumulator;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/** Max bytes retained per stream, so a runaway harness can't OOM the eval. */
export const MAX_RETAINED_BYTES = 8 * 1024 * 1024;

/**
 * Append `chunk` to `current`, capping total length at `max`. Once the cap is
 * reached a single truncation marker is added and the string stops growing.
 * The live line parser still sees every line — only the retained diagnostic
 * copy is bounded.
 */
export function appendCapped(current: string, chunk: string, max = MAX_RETAINED_BYTES): string {
  if (current.length >= max) return current;
  const next = current + chunk;
  if (next.length <= max) return next;
  return next.slice(0, max) + "\n…[output truncated]…";
}

export function emptyRunnerResult(): RunnerResult {
  return {
    exitCode: 0,
    durationMs: 0,
    startedAt: Date.now(),
    endedAt: null,
    transcript: [],
    toolCalls: [],
    finalText: "",
    resultText: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
    stopReason: null,
    sessionId: null,
    model: null,
    isError: false,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
  };
}

export function spawnHarnessProcess(ctx: RunnerContext, onLine: (line: string, acc: ParseAccumulator) => void): Promise<SpawnHarnessResult> {
  const adapter = getAdapter(ctx.harness);
  const { bin, args, env: extraEnv, stdin } = adapter.buildCommand(ctx);
  const startedAt = Date.now();
  const acc: ParseAccumulator = {
    startedAt,
    transcript: [] as TranscriptEntry[],
    toolCalls: [] as RunnerResult["toolCalls"],
    finalText: "",
    result: null as Partial<RunnerResult> | null,
  };
  let stdout = "";
  let stderr = "";
  let stdoutBuf = "";

  let timedOut = false;

  return new Promise<SpawnHarnessResult>((resolve) => {
    const proc = spawn(bin, args, {
      cwd: ctx.workdir,
      env: { ...process.env, ...extraEnv },
      stdio: [stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (stdin != null && proc.stdin) {
      // A child that exits before reading stdin emits EPIPE on this stream;
      // without a handler that error is unhandled and crashes the eval process.
      proc.stdin.on("error", () => {});
      try { proc.stdin.write(stdin); proc.stdin.end(); } catch {}
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGKILL"); } catch {}
    }, ctx.timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = appendCapped(stdout, text);
      stdoutBuf += text;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) onLine(line, acc);
    });
    proc.stderr?.on("data", (c: Buffer) => { stderr = appendCapped(stderr, c.toString()); });

    let settled = false;
    const finish = (exitCode: number) => {
      if (settled) return; // 'error' and 'close' can both fire; flush only once
      settled = true;
      clearTimeout(timer);
      if (stdoutBuf.trim()) {
        try { onLine(stdoutBuf, acc); } catch {}
      }
      resolve({ acc, stdout, stderr, exitCode, durationMs: Date.now() - startedAt, timedOut });
    };
    proc.on("error", () => finish(2));
    proc.on("close", (code) => finish(code ?? (acc.result?.isError ? 1 : 0)));
  });
}