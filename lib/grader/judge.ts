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

/**
 * Extract a JSON object from a judge's reply, tolerating prose, code fences, or
 * chain-of-thought around it. Tries the widest `{…}` span first, then narrows
 * the start forward until one parses — far more robust than a single greedy
 * match, which fails whenever the model adds any text around the JSON.
 */
export function extractJudgeJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const direct = text.trim();
  try {
    const v = JSON.parse(direct);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  for (let start = text.indexOf("{"); start !== -1 && start < end; start = text.indexOf("{", start + 1)) {
    try {
      const v = JSON.parse(text.slice(start, end + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {}
  }
  return null;
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