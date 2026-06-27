import type { RunCaseRecord, RunSummary } from "./types";

export function computeSummary(cases: RunCaseRecord[]): RunSummary {
  const byCategory: Record<string, { total: number; passed: number; failed: number; errored: number }> = {};
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let skipped = 0;
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalDurationMs = 0;

  for (const c of cases) {
    const cat = c.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0, failed: 0, errored: 0 };
    byCategory[cat].total++;
    if (c.status === "passed") { passed++; byCategory[cat].passed++; }
    else if (c.status === "failed") { failed++; byCategory[cat].failed++; }
    else if (c.status === "error") { errored++; byCategory[cat].errored++; }
    else if (c.status === "skipped") skipped++;
    if (c.runner_result) {
      totalCostUsd += c.runner_result.usage.costUsd || 0;
      totalTokensIn += c.runner_result.usage.inputTokens || 0;
      totalTokensOut += c.runner_result.usage.outputTokens || 0;
      totalDurationMs += c.runner_result.durationMs || 0;
    }
  }
  const total = cases.length;
  return {
    total,
    passed,
    failed,
    errored,
    skipped,
    passRate: total ? passed / total : 0,
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    totalDurationMs,
    byCategory,
  };
}