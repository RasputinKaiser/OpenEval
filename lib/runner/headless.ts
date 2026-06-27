import { spawn } from "node:child_process";
import { NCODE_BIN } from "../config";
import { emit, parseStreamLine, type Runner } from "./parse";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

export class HeadlessRunner implements Runner {
  kind = "headless" as const;

  async run(ctx: RunnerContext): Promise<RunnerResult> {
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

    const startedAt = Date.now();
    emit(ctx, { kind: "started", at: startedAt });

    return new Promise<RunnerResult>((resolve) => {
      const proc = spawn(NCODE_BIN, args, {
        cwd: ctx.workdir,
        env: { ...process.env, NCODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      const acc = {
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
          for (const ev of parseStreamLine(line, acc)) emit(ctx, ev);
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
          for (const ev of parseStreamLine(stdoutBuf, acc)) emit(ctx, ev);
        }
        const durationMs = Date.now() - startedAt;
        const exitCode = code ?? (acc.result?.isError ? 1 : 0);

        if (acc.result) {
          emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });
          resolve({ ...acc.result, exitCode, durationMs } as RunnerResult);
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
  acc: { transcript: TranscriptEntry[]; toolCalls: RunnerResult["toolCalls"]; finalText: string; result: Partial<RunnerResult> | null },
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
  };
}