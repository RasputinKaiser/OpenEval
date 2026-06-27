import type { CaseTelemetry, RunCaseRecord, RunSummary, RunTelemetry } from "./types";

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
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function caseTelemetry(c: RunCaseRecord): CaseTelemetry {
  const r = c.runner_result;
  if (!r) {
    return {
      tokPerSec: 0, inTokPerSec: 0, toolCallCount: 0, toolCallCounts: {},
      errorCount: 0, cacheHitRate: 0, tokensPerCase: 0, costPerCase: 0, msPerTurn: 0, msPerTool: 0,
    };
  }
  const durSec = Math.max(r.durationMs / 1000, 0.001);
  const tokPerSec = r.usage.outputTokens / durSec;
  const inTokPerSec = r.usage.inputTokens / durSec;
  const toolCallCount = r.toolCalls.length;
  const toolDurations = r.toolCalls.map((t) => t.durationMs ?? 0).filter((x) => x > 0);
  const msPerTool = toolDurations.length ? toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length : 0;
  const msPerTurn = r.numTurns > 0 ? r.durationMs / r.numTurns : 0;
  const cacheTotal = r.usage.cacheReadTokens + r.usage.cacheCreateTokens + r.usage.inputTokens;
  const cacheHitRate = cacheTotal > 0 ? r.usage.cacheReadTokens / cacheTotal : 0;
  const errorCount = r.toolCalls.filter((t) => t.isError).length;
  return {
    tokPerSec,
    inTokPerSec,
    toolCallCount,
    toolCallCounts: r.toolCallCounts || {},
    errorCount,
    cacheHitRate,
    tokensPerCase: r.usage.inputTokens + r.usage.outputTokens,
    costPerCase: r.usage.costUsd || 0,
    msPerTurn,
    msPerTool,
  };
}

export function computeTelemetry(cases: RunCaseRecord[]): RunTelemetry {
  const completed = cases.filter((c) => c.runner_result);
  const durations = completed.map((c) => c.runner_result!.durationMs).sort((a, b) => a - b);
  const tpsValues = completed.map(caseTelemetry).map((t) => t.tokPerSec).sort((a, b) => a - b);
  const totalOut = completed.reduce((a, c) => a + c.runner_result!.usage.outputTokens, 0);
  const totalDurSec = completed.reduce((a, c) => a + c.runner_result!.durationMs, 0) / 1000;
  const avgTokPerSec = totalDurSec > 0 ? totalOut / totalDurSec : 0;

  const toolCounts: Record<string, number> = {};
  let cacheRead = 0, cacheTotalAll = 0;
  for (const c of completed) {
    const t = caseTelemetry(c);
    for (const [name, n] of Object.entries(t.toolCallCounts)) toolCounts[name] = (toolCounts[name] || 0) + n;
    cacheRead += c.runner_result!.usage.cacheReadTokens;
    cacheTotalAll += c.runner_result!.usage.cacheReadTokens + c.runner_result!.usage.cacheCreateTokens + c.runner_result!.usage.inputTokens;
  }
  const topTools = Object.entries(toolCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  const errored = cases.filter((c) => c.status === "error" || c.status === "failed").length;
  const totalTurns = completed.reduce((a, c) => a + c.runner_result!.numTurns, 0);

  const perCase = cases.map((c) => {
    const t = caseTelemetry(c);
    const r = c.runner_result;
    return {
      caseId: c.case_id,
      caseName: c.case_name,
      tokPerSec: t.tokPerSec,
      inTokPerSec: t.inTokPerSec,
      durationMs: r?.durationMs ?? 0,
      costUsd: t.costPerCase,
      tokens: t.tokensPerCase,
      passed: c.status === "passed",
    };
  });

  return {
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    p50TokPerSec: percentile(tpsValues, 0.5),
    maxTokPerSec: tpsValues.length ? tpsValues[tpsValues.length - 1] : 0,
    avgTokPerSec,
    totalToolCalls: Object.values(toolCounts).reduce((a, b) => a + b, 0),
    topTools,
    cacheHitRate: cacheTotalAll > 0 ? cacheRead / cacheTotalAll : 0,
    errorRate: cases.length ? errored / cases.length : 0,
    avgTurns: completed.length ? totalTurns / completed.length : 0,
    perCase,
  };
}
