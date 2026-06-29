import { getAdapter } from "../adapters/registry";
import type { RunnerContext } from "../types";
import { spawnHarnessProcess, emptyRunnerResult } from "../runner/spawn";

export interface JudgeResult {
  ok: boolean;
  text: string;
  durationMs: number;
  raw: string;
  error?: string;
}

export async function runJudge(opts: {
  harness: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
}): Promise<JudgeResult> {
  const ctx: RunnerContext = {
    caseId: "llm-judge",
    workdir: process.cwd(),
    prompt: opts.prompt,
    maxTurns: 1,
    timeoutMs: opts.timeoutMs,
    permissionMode: "bypassPermissions",
    model: opts.model,
    extraArgs: [],
    harness: opts.harness,
  };
  const { acc, stdout, stderr, exitCode, durationMs } = await spawnHarnessProcess(ctx, (line, accumulator) => {
    const adapter = getAdapter(opts.harness);
    try { adapter.parseLine(line, accumulator); } catch {}
  });
  const r = acc.result || emptyRunnerResult();
  const text = r.finalText || r.resultText || acc.finalText || stdout;
  const ok = (exitCode === 0 || exitCode === null || acc.result === null) && !r.isError && !!text;
  return {
    ok,
    text,
    durationMs,
    raw: stdout,
    error: r.isError ? text : stderr.trim() || undefined,
  };
}