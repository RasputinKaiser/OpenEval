import { displayModelId, rateForModelInfo } from "../pricing";
import type { LiveAggregate, LiveQueueSummary, LiveSession, LiveTraceSource, LiveUsageSummary } from "./types";
import { resolveLiveSource } from "./sources";
import { attributedModelUsage, increment, metricMissing, modelUsageCosts, modelUsageVolume, topEntries } from "./util";

function emptyUsageSummary(): LiveUsageSummary {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreateTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    sessionsWithMeasuredUsage: 0,
    sessionsWithMeasuredCost: 0,
    sessionsWithPricedUsage: 0,
    sessionsWithListedRate: 0,
    sessionsWithFamilyRate: 0,
    sessionsWithFallbackRate: 0,
    tokenCoverage: 0,
    costCoverage: 0,
    avgOutputTokPerSec: 0,
  };
}

/**
 * Sessions retained on the aggregate's `sessions` field by default. The /live
 * payload size depends on this cap; callers that need more (Collection's
 * full-history browse) pass an explicit `sessionRetention`. All `total*`
 * scalars are computed over EVERY session regardless of retention.
 */
const DEFAULT_SESSION_RETENTION = 100;

export function aggregate(sessions: LiveSession[], scanWarnings: string[] = [], source: LiveTraceSource = resolveLiveSource(), sessionRetention: number = DEFAULT_SESSION_RETENTION): LiveAggregate {
  const byModelMap = new Map<string, {
    model: string;
    sessions: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    toolCalls: number;
    errors: number;
    totalDur: number;
    totalQuality: number;
    missingTokens: number;
    missingCost: number;
    pricedSessions: number;
    measuredCostSessions: number;
    allocatedCostSessions: number;
    listedRateSessions: number;
    familyRateSessions: number;
    fallbackRateSessions: number;
    inferredModelSessions: number;
  }>();
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreateTokens = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let totalQuality = 0;
  const projects = new Set<string>();
  const toolCallsByName = new Map<string, number>();
  const toolErrorsByName = new Map<string, number>();
  const branchSessions = new Map<string, number>();
  const fileSessions = new Map<string, number>();
  const queueTotals: LiveQueueSummary = { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] };
  let sidechainMessages = 0;
  let agentSessions = 0;
  let outputTokPerSecTotal = 0;
  let outputTokPerSecCount = 0;
  let sessionsWithMeasuredUsage = 0;
  let sessionsWithMeasuredCost = 0;
  let sessionsWithPricedUsage = 0;
  let sessionsWithListedRate = 0;
  let sessionsWithFamilyRate = 0;
  let sessionsWithFallbackRate = 0;
  let sessionsWithMeasuredDuration = 0;
  let sessionsWithMissingModel = 0;
  let sessionsWithInferredModel = 0;
  let sessionsWithMissingTokens = 0;
  let sessionsWithInferredCost = 0;
  let archivedSessions = 0;
  let sessionsWithMalformedLines = 0;
  let staleSessions = 0;
  // rateForModelInfo is a pure lookup over a static catalog; memoize per
  // aggregate() call so large session lists don't redo alias/family resolution
  // thousands of times. Deliberately per-call, not module-global: if the
  // pricing catalog ever becomes dynamic, this cache can never serve stale rates.
  const rateInfoByModel = new Map<string | null, ReturnType<typeof rateForModelInfo>>();
  const cachedRateInfo = (model: string | null) => {
    let info = rateInfoByModel.get(model);
    if (info === undefined) {
      info = rateForModelInfo(model);
      rateInfoByModel.set(model, info);
    }
    return info;
  };

  for (const s of sessions) {
    projects.add(s.project);
    totalCostUsd += s.costUsd;
    totalInputTokens += s.inputTokens;
    totalOutputTokens += s.outputTokens;
    totalCacheReadTokens += s.cacheReadTokens;
    totalCacheCreateTokens += s.cacheCreateTokens;
    totalToolCalls += s.toolCalls;
    totalToolErrors += s.toolErrors;
    totalQuality += s.dataQuality;
    sidechainMessages += s.traceGraph.sidechainMessages;
    if (s.traceGraph.agentCount > 0) agentSessions++;
    if (s.metricSources.tokens === "measured" && s.outputTokens > 0 && s.durationMs > 0) {
      outputTokPerSecTotal += s.outputTokens / Math.max(s.durationMs / 1000, 0.001);
      outputTokPerSecCount++;
    }
    if (s.metricSources.tokens === "measured") sessionsWithMeasuredUsage++;
    if (s.metricSources.tokens === "missing") sessionsWithMissingTokens++;
    if (s.metricSources.cost === "measured") sessionsWithMeasuredCost++;
    if (s.metricSources.cost === "inferred") sessionsWithInferredCost++;
    if (s.metricSources.duration === "measured") sessionsWithMeasuredDuration++;
    if (s.metricSources.model === "missing") sessionsWithMissingModel++;
    if (s.metricSources.model === "inferred") sessionsWithInferredModel++;
    if (s.costUsd > 0) sessionsWithPricedUsage++;
    if (s.metricSources.cost === "inferred" && s.costUsd > 0) {
      const confidence = cachedRateInfo(s.model)?.confidence;
      if (confidence === "listed") sessionsWithListedRate++;
      else if (confidence === "family") sessionsWithFamilyRate++;
      else if (confidence === "fallback") sessionsWithFallbackRate++;
    }
    if (s.archived) archivedSessions++;
    if (s.malformedLineCount > 0) sessionsWithMalformedLines++;
    if (s.staleMs > 1000 * 60 * 60 * 12) staleSessions++;
    if (s.modeSummary.gitBranch) increment(branchSessions, s.modeSummary.gitBranch);
    queueTotals.enqueue += s.queueSummary.enqueue;
    queueTotals.dequeue += s.queueSummary.dequeue;
    queueTotals.remove += s.queueSummary.remove;
    queueTotals.popAll += s.queueSummary.popAll;
    if (queueTotals.preview.length < 5) queueTotals.preview.push(...s.queueSummary.preview.slice(0, 5 - queueTotals.preview.length));
    for (const tool of s.toolSummaries) {
      increment(toolCallsByName, tool.name, tool.calls);
      increment(toolErrorsByName, tool.name, tool.errors);
    }
    for (const file of s.fileActivity.touchedFiles) increment(fileSessions, file);
    const modelRows = attributedModelUsage(s);
    const rowCosts = modelUsageCosts(s, modelRows);
    for (const [index, row] of modelRows.entries()) {
      const key = displayModelId(row.model) || "unknown";
      const cur = byModelMap.get(key) || {
        model: key, sessions: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        toolCalls: 0, errors: 0, totalDur: 0, totalQuality: 0, missingTokens: 0, missingCost: 0,
        pricedSessions: 0, measuredCostSessions: 0, allocatedCostSessions: 0, listedRateSessions: 0, familyRateSessions: 0,
        fallbackRateSessions: 0, inferredModelSessions: 0,
      };
      const rowCost = rowCosts[index] ?? 0;
      cur.sessions++;
      cur.costUsd += rowCost;
      cur.inputTokens += row.inputTokens;
      cur.outputTokens += row.outputTokens;
      cur.cacheReadTokens += row.cacheReadTokens;
      cur.toolCalls += row.toolCalls;
      cur.errors += row.toolErrors;
      cur.totalDur += s.durationMs;
      cur.totalQuality += s.dataQuality;
      if (metricMissing(s.metricSources.tokens)) cur.missingTokens++;
      if (metricMissing(s.metricSources.cost) || (s.metricSources.cost === "inferred" && rowCost === 0 && modelUsageVolume(row) > 0)) cur.missingCost++;
      if (rowCost > 0) cur.pricedSessions++;
      if (s.metricSources.cost === "measured" && rowCost > 0) {
        if (modelRows.length > 1) cur.allocatedCostSessions++;
        else cur.measuredCostSessions++;
      }
      if (s.metricSources.model === "inferred") cur.inferredModelSessions++;
      if (s.metricSources.cost === "inferred" && rowCost > 0) {
        const confidence = cachedRateInfo(row.model)?.confidence;
        if (confidence === "listed") cur.listedRateSessions++;
        else if (confidence === "family") cur.familyRateSessions++;
        else if (confidence === "fallback") cur.fallbackRateSessions++;
      }
      byModelMap.set(key, cur);
    }
  }

  const byModel = Array.from(byModelMap.values()).map((m) => ({
    model: m.model,
    sessions: m.sessions,
    costUsd: m.costUsd,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    toolCalls: m.toolCalls,
    errors: m.errors,
    avgDurationMs: m.sessions ? m.totalDur / m.sessions : 0,
    avgDataQuality: m.sessions ? m.totalQuality / m.sessions : 0,
    missingTokens: m.missingTokens,
    missingCost: m.missingCost,
    pricedSessions: m.pricedSessions,
    measuredCostSessions: m.measuredCostSessions,
    allocatedCostSessions: m.allocatedCostSessions,
    listedRateSessions: m.listedRateSessions,
    familyRateSessions: m.familyRateSessions,
    fallbackRateSessions: m.fallbackRateSessions,
    inferredModelSessions: m.inferredModelSessions,
  })).sort((a, b) => b.errors - a.errors || a.avgDataQuality - b.avgDataQuality);

  const usageSummary = emptyUsageSummary();
  usageSummary.totalInputTokens = totalInputTokens;
  usageSummary.totalOutputTokens = totalOutputTokens;
  usageSummary.totalCacheReadTokens = totalCacheReadTokens;
  usageSummary.totalCacheCreateTokens = totalCacheCreateTokens;
  usageSummary.totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheCreateTokens;
  usageSummary.totalCostUsd = totalCostUsd;
  usageSummary.sessionsWithMeasuredUsage = sessionsWithMeasuredUsage;
  usageSummary.sessionsWithMeasuredCost = sessionsWithMeasuredCost;
  usageSummary.sessionsWithPricedUsage = sessionsWithPricedUsage;
  usageSummary.sessionsWithListedRate = sessionsWithListedRate;
  usageSummary.sessionsWithFamilyRate = sessionsWithFamilyRate;
  usageSummary.sessionsWithFallbackRate = sessionsWithFallbackRate;
  usageSummary.tokenCoverage = sessions.length ? usageSummary.sessionsWithMeasuredUsage / sessions.length : 0;
  usageSummary.costCoverage = sessions.length ? usageSummary.sessionsWithPricedUsage / sessions.length : 0;
  usageSummary.avgOutputTokPerSec = outputTokPerSecCount ? outputTokPerSecTotal / outputTokPerSecCount : 0;

  return {
    sourceHarness: source.id,
    sourceLabel: source.label,
    sourceStatus: source.status,
    sourceRoots: source.roots,
    sourceMessage: source.message,
    usageSummary,
    totalSessions: sessions.length,
    totalProjects: projects.size,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalToolCalls,
    totalToolErrors,
    sessionsWithMeasuredDuration,
    sessionsWithMissingModel,
    sessionsWithInferredModel,
    sessionsWithMissingTokens,
    sessionsWithInferredCost,
    archivedSessions,
    sessionsWithMalformedLines,
    staleSessions,
    avgDataQuality: sessions.length ? totalQuality / sessions.length : 0,
    scanWarnings,
    byModel,
    byTool: topEntries(toolCallsByName, 10).map(({ key, count }) => ({
      name: key,
      calls: count,
      errors: toolErrorsByName.get(key) ?? 0,
    })),
    queueTotals,
    sidechainMessages,
    agentSessions,
    topBranches: topEntries(branchSessions, 8).map(({ key, count }) => ({ branch: key, sessions: count })),
    topFiles: topEntries(fileSessions, 10).map(({ key, count }) => ({ file: key, sessions: count })),
    sessions: sessions.slice(0, sessionRetention),
  };
}
