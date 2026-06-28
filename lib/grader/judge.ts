import { spawn } from "node:child_process";
import { getAdapter } from "../adapters/registry";
import type { ParseAccumulator } from "../adapters/types";
import type { RunnerResult, TranscriptEntry } from "../types";

export interface JudgeResult {
  ok: boolean;
  text: string;
  durationMs: number;
  raw: string;
  error?: string;
}

function emptyResult(): Partial<RunnerResult> {
  return {
    exitCode: 0, durationMs: 0, startedAt: Date.now(), endedAt: null,
    transcript: [], toolCalls: [], finalText: "", resultText: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0, stopReason: null, sessionId: null, model: null, isError: false, rawJson: null,
    tokenSegments: [], toolCallCounts: {},
  };
}

export async function runJudge(opts: {
  harness: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
}): Promise<JudgeResult> {
  const adapter = getAdapter(opts.harness);
  const ctx = {
    caseId: "llm-judge",
    workdir: process.cwd(),
    prompt: opts.prompt,
    maxTurns: 1,
    timeoutMs: opts.timeoutMs,
    permissionMode: "bypassPermissions" as const,
    model: opts.model,
    extraArgs: [] as string[],
    harness: opts.harness,
  };
  const { bin, args, env: extraEnv } = adapter.buildCommand(ctx);
  const startedAt = Date.now();
  const acc: ParseAccumulator = { startedAt, transcript: [] as TranscriptEntry[], toolCalls: [], finalText: "", result: emptyResult() };
  let stdout = "";
  let stderr = "";

  return new Promise<JudgeResult>((resolve) => {
    const proc = spawn(bin, args, {
      cwd: ctx.workdir,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, opts.timeoutMs);
    let stdoutBuf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuf += text;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        try { adapter.parseLine(line, acc); } catch {}
      }
    });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, text: "", durationMs: Date.now() - startedAt, raw: stdout, error: String(err) });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) { try { adapter.parseLine(stdoutBuf, acc); } catch {} }
      const r = acc.result;
      const text = r?.finalText || r?.resultText || acc.finalText || stdout;
      const ok = (code === 0 || code === null) && !r?.isError && !!text;
      resolve({
        ok,
        text,
        durationMs: Date.now() - startedAt,
        raw: stdout,
        error: r?.isError ? text : stderr.trim() || undefined,
      });
    });
  });
}
