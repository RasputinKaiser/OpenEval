import type { CaseTelemetry, RunCaseRecord, RunSummary, RunTelemetry } from "./types";
import { passAtK as passAtKEstimate, wilsonInterval, mean } from "./stats";

export function computeSummary(cases: RunCaseRecord[]): RunSummary {
  const byCategory: Record<string, { total: number; passed: number; failed: number; errored: number }> = {};
  const byDifficulty: Record<string, { total: number; passed: number; failed: number; errored: number }> = {};
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let skipped = 0;
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalDurationMs = 0;

  const buckets: Record<string, RunCaseRecord[]> = {};
  let samples = 0;
  for (const c of cases) {
    (buckets[c.case_id] ||= []).push(c);
    samples = Math.max(samples, (c.sample ?? 0) + 1);
  }
  for (const c of cases) {
    const cat = c.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0, failed: 0, errored: 0 };
    byCategory[cat].total++;
    const diff = c.difficulty ?? "untiered";
    if (!byDifficulty[diff]) byDifficulty[diff] = { total: 0, passed: 0, failed: 0, errored: 0 };
    byDifficulty[diff].total++;
    if (c.status === "passed") { passed++; byCategory[cat].passed++; byDifficulty[diff].passed++; }
    else if (c.status === "failed") { failed++; byCategory[cat].failed++; byDifficulty[diff].failed++; }
    else if (c.status === "error") { errored++; byCategory[cat].errored++; byDifficulty[diff].errored++; }
    else if (c.status === "skipped") skipped++;
    if (c.runner_result) {
      totalCostUsd += c.runner_result.usage.costUsd || 0;
      totalTokensIn += c.runner_result.usage.inputTokens || 0;
      totalTokensOut += c.runner_result.usage.outputTokens || 0;
      totalDurationMs += c.runner_result.durationMs || 0;
    }
  }
  const total = cases.length;

  // Per-case (n samples, c passed) → unbiased pass@k estimates, averaged over
  // unique cases. k is the run's sample budget. pass@1 is the low-variance mean
  // c/n (not "did trial 0 pass"); pass^k ("reliability") stays "all k passed".
  const k = samples > 0 ? samples : 1;
  const perCasePassAt1: number[] = [];
  const perCasePassAtK: number[] = [];
  let passPowK = 0, uniqueCases = 0;
  for (const list of Object.values(buckets)) {
    const n = list.length;
    const c = list.filter((rc) => rc.status === "passed").length;
    uniqueCases++;
    perCasePassAt1.push(passAtKEstimate(n, c, 1));
    perCasePassAtK.push(passAtKEstimate(n, c, k));
    if (n > 0 && c === n) passPowK++;
  }
  const passAt1 = mean(perCasePassAt1);
  const passAtK = mean(perCasePassAtK);
  // Honest 95% uncertainty band on pass@1, at the level of independent units
  // (unique cases), rather than pseudo-replicating over correlated samples.
  const passAt1Ci95 = wilsonInterval(Math.round(passAt1 * uniqueCases), uniqueCases);

  return {
    total,
    passed,
    failed,
    errored,
    skipped,
    passRate: total ? passed / total : 0,
    passAt1,
    passAtK,
    passPowK: uniqueCases ? passPowK / uniqueCases : 0,
    passAt1Ci95,
    samples: samples > 0 ? samples : 1,
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    totalDurationMs,
    byCategory,
    byDifficulty,
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
      durationSource: "missing",
      tokenSource: "missing",
      toolSource: "missing",
      throughputMode: "output_tokens_per_runner_wall_second",
      toolDurationCoverage: 0,
      warnings: ["runner result missing"],
    };
  }
  const warnings: string[] = [];
  const hasDuration = r.durationMs > 0;
  const hasUsage = r.usage.inputTokens > 0 || r.usage.outputTokens > 0 || r.usage.cacheReadTokens > 0 || r.usage.cacheCreateTokens > 0;
  const durSec = Math.max(r.durationMs / 1000, 0.001);
  const tokPerSec = r.usage.outputTokens / durSec;
  const inTokPerSec = r.usage.inputTokens / durSec;
  const toolCallCount = r.toolCalls.length;
  const toolDurations = r.toolCalls.map((t) => t.durationMs ?? 0).filter((x) => x > 0);
  const toolDurationCoverage = toolCallCount > 0 ? toolDurations.length / toolCallCount : 1;
  const msPerTool = toolDurations.length ? toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length : 0;
  const msPerTurn = r.numTurns > 0 ? r.durationMs / r.numTurns : 0;
  const cacheTotal = r.usage.cacheReadTokens + r.usage.cacheCreateTokens + r.usage.inputTokens;
  const cacheHitRate = cacheTotal > 0 ? r.usage.cacheReadTokens / cacheTotal : 0;
  const errorCount = r.toolCalls.filter((t) => t.isError).length;
  const summaryToolCount = Object.values(r.toolCallCounts || {}).reduce((a, b) => a + b, 0);
  if (!hasDuration) warnings.push("duration missing; throughput is zeroed");
  if (!hasUsage) warnings.push("CLI usage missing; token and cost metrics are zeroed");
  if (toolCallCount === 0 && summaryToolCount > 0) warnings.push("tool summary exists but raw tool events are missing");
  if (toolCallCount > 0 && toolDurationCoverage < 1) warnings.push(`${Math.round(toolDurationCoverage * 100)}% of tool calls have measured duration`);
  if (summaryToolCount > 0 && summaryToolCount !== toolCallCount) warnings.push(`tool count mismatch: events=${toolCallCount}, summary=${summaryToolCount}`);
  if (r.durationMs > 0 && r.endedAt && r.startedAt && Math.abs((r.endedAt - r.startedAt) - r.durationMs) > 1000) {
    warnings.push("runner wall duration differs from result timestamps");
  }
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
    durationSource: hasDuration ? "runner_wall" : "missing",
    tokenSource: hasUsage ? "cli_usage" : "missing",
    toolSource: toolCallCount > 0 ? "stream_tool_events" : summaryToolCount > 0 ? "summary_counts" : "missing",
    throughputMode: "output_tokens_per_runner_wall_second",
    toolDurationCoverage,
    warnings,
  };
}

export function computeTelemetry(cases: RunCaseRecord[]): RunTelemetry {
  const completed = cases.filter((c) => c.runner_result);
  const durations = completed.map((c) => c.runner_result!.durationMs).sort((a, b) => a - b);
  const caseTs = completed.map(caseTelemetry);
  const tpsValues = caseTs.map((t) => t.tokPerSec).sort((a, b) => a - b);
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

  let forbiddenViolations = 0;
  let cheapestPassUsd = Infinity;
  for (const c of completed) {
    const gr = c.grader_result;
    if (gr) {
      const fv = gr.results.some((r: any) => (r.spec as any).forbidden && !r.passed);
      if (fv) forbiddenViolations++;
    }
    if (c.status === "passed" && c.runner_result!.usage.costUsd < cheapestPassUsd) {
      cheapestPassUsd = c.runner_result!.usage.costUsd;
    }
  }

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
      toolCallCount: t.toolCallCount,
      toolErrorCount: t.errorCount,
      toolDurationCoverage: t.toolDurationCoverage,
      warnings: t.warnings,
    };
  });
  const measuredDurationCases = caseTs.filter((t) => t.durationSource === "runner_wall").length;
  const usageReportedCases = caseTs.filter((t) => t.tokenSource === "cli_usage").length;
  const toolEventCases = caseTs.filter((t) => t.toolSource === "stream_tool_events").length;
  const totalToolCallsWithEvents = caseTs.reduce((sum, t) => sum + t.toolCallCount, 0);
  const totalMeasuredToolDurations = completed.reduce(
    (sum, c) => sum + c.runner_result!.toolCalls.filter((tool) => (tool.durationMs ?? 0) > 0).length,
    0
  );
  const telemetryWarnings = Array.from(new Set(caseTs.flatMap((t) => t.warnings))).slice(0, 8);

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
    forbiddenViolationRate: completed.length ? forbiddenViolations / completed.length : 0,
    failsSafelyRate: completed.length ? (completed.length - forbiddenViolations) / completed.length : 1,
    cheapestPassUsd: cheapestPassUsd === Infinity ? 0 : cheapestPassUsd,
    quality: {
      completedCases: completed.length,
      measuredDurationCases,
      usageReportedCases,
      toolEventCases,
      toolDurationCoverage: totalToolCallsWithEvents > 0 ? totalMeasuredToolDurations / totalToolCallsWithEvents : 1,
      throughputMode: "output_tokens_per_runner_wall_second",
      warnings: telemetryWarnings,
    },
    perCase,
  };
}
