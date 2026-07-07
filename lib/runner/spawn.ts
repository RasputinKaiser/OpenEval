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

  return new Promise<SpawnHarnessResult>((resolve) => {
    const proc = spawn(bin, args, {
      cwd: ctx.workdir,
      env: { ...process.env, ...extraEnv },
      stdio: [stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (stdin != null && proc.stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, ctx.timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuf += text;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) onLine(line, acc);
    });
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    const finish = (exitCode: number) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) {
        try { onLine(stdoutBuf, acc); } catch {}
      }
      resolve({ acc, stdout, stderr, exitCode, durationMs: Date.now() - startedAt });
    };
    proc.on("error", () => finish(2));
    proc.on("close", (code) => finish(code ?? (acc.result?.isError ? 1 : 0)));
  });
}