import test from "node:test";
import assert from "node:assert/strict";
import type { CollectedSession } from "../lib/collection/aggregate";
import {
  buildAnalysisReport,
  canonicalModel,
  filterAnalysisSessions,
} from "../lib/collection/analysis";

function session(overrides: Partial<CollectedSession> = {}): CollectedSession {
  const base: CollectedSession = {
    sessionId: "same-session",
    sourceId: "source-a",
    sourceLabel: "Source A",
    displayTitle: "private title",
    lastPromptPreview: "private prompt",
    project: "/private/project",
    model: "gpt-5.6-luna",
    startedAt: Date.parse("2026-01-05T12:00:00.000Z"),
    lastEventAt: Date.parse("2026-01-05T12:01:00.000Z"),
    durationMs: 120_000,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    totalTokens: 150,
    costUsd: 0.25,
    usageSegments: [],
    toolCalls: 4,
    toolErrors: 1,
    numTurns: 1,
    stopReason: null,
    isError: false,
    pathBytes: 1,
    lineCount: 1,
    malformedLineCount: 0,
    thinkingBlocks: 0,
    textBlocks: 1,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount: 1,
    userType: null,
    dataQuality: 1,
    metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" },
    parseWarnings: [],
    toolErrorRate: 0.25,
    toolCallsPerTurn: 4,
    textAvailability: 1,
    staleMs: 0,
    traceGraph: { rootMessages: 1, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [{ name: "Read", calls: 3, errors: 1 }, { name: "Write", calls: 1, errors: 0 }],
    toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion: null,
    outcomeSignals: { userPositive: 1, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: true, reworkFiles: 0 },
  };
  return { ...base, ...overrides, metricSources: { ...base.metricSources, ...(overrides.metricSources ?? {}) } };
}

test("Collection analysis filters source-qualified sessions and keeps options from the base population", () => {
  const population = [
    session(),
    session({ sourceId: "source-b", sourceLabel: "Source B", model: "/Users/operator/models/Model-X", startedAt: Date.parse("2026-01-06T12:00:00.000Z") }),
    session({ sourceId: "source-b", sessionId: "other", toolSummaries: [{ name: "Bash", calls: 2, errors: 2 }], startedAt: Date.parse("2026-01-07T12:00:00.000Z") }),
  ];
  const selection = { source: "source-b", model: "models/model-x" as string, tool: "Bash" };
  const matched = filterAnalysisSessions(population, selection);
  assert.equal(matched.length, 0, "the canonical model key must match the lowercased display id exactly");
  const canonical = canonicalModel(population[1].model);
  assert.equal(canonical, "models/model-x");
  const selected = filterAnalysisSessions(population, { source: "source-b", model: canonical });
  assert.equal(selected.length, 1);
  const report = buildAnalysisReport(population, selected, { source: "source-b", model: canonical }, { generatedAtMs: 42 }, { offset: 0, limit: 1 });
  assert.equal(report.population, 3);
  assert.equal(report.totalMatched, 1);
  assert.deepEqual(report.options.sources.map((option) => option.value), ["source-a", "source-b"]);
  assert.ok(report.options.models.some((option) => option.value === canonical));
  assert.equal(report.sessions[0].sourceId, "source-b");
  assert.equal(report.sessions[0].sessionId, "same-session");
  assert.equal("path" in report.sessions[0], false);
  assert.equal("displayTitle" in report.sessions[0], false);
});

test("Collection analysis keeps unavailable metrics null and computes full summaries before paging", () => {
  const available = session({ sessionId: "available", costUsd: 0, metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" } });
  const missing = session({
    sessionId: "missing",
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
    metricSources: { model: "measured", tokens: "missing", cost: "missing", duration: "missing", turns: "measured" },
    toolSummaries: [{ name: "Read", calls: 5, errors: 2 }],
  });
  const report = buildAnalysisReport(
    [available, missing],
    [available, missing],
    {},
    { generatedAtMs: 100, stale: true, partial: true },
    { offset: 1, limit: 1 },
  );
  assert.equal(report.evidence.scope, "parsed snapshot");
  assert.equal(report.evidence.partial, true);
  assert.equal(report.evidence.stale, true);
  assert.equal(report.sessions.length, 1);
  assert.equal(report.usageTotals.tokens, 150);
  assert.equal(report.usageTotals.durationMs, 120_000);
  assert.equal(report.usageTotals.costUsd, 0);
  assert.equal(report.tokenHistogram.eligible, 1);
  assert.equal(report.tokenHistogram.missing, 1);
  assert.equal(report.durationHistogram.eligible, 1);
  assert.equal(report.durationHistogram.missing, 1);
  const missingRow = report.sessions.find((row) => row.sessionId === "missing");
  assert.equal(missingRow?.tokens, null);
  assert.equal(missingRow?.durationMs, null);
  assert.equal(missingRow?.costUsd, null);
  assert.equal(report.toolGroups.find((group) => group.key === "Read")?.toolErrors, 3);
  assert.equal(report.nextOffset, null);
});

test("Collection analysis uses local weekday and exclusive date bounds", () => {
  const monday = Date.parse("2026-01-05T09:00:00.000Z");
  const tuesday = Date.parse("2026-01-06T10:00:00.000Z");
  const population = [session({ startedAt: monday }), session({ sessionId: "tuesday", startedAt: tuesday })];
  const mondayDay = (new Date(monday).getDay() + 6) % 7;
  assert.equal(filterAnalysisSessions(population, { fromMs: monday, toMs: tuesday }).length, 1);
  assert.equal(filterAnalysisSessions(population, { weekday: mondayDay }).length, 1);
  assert.equal(filterAnalysisSessions(population, { hour: new Date(monday).getHours() }).length, 1);
});

test("time buckets spanning more than 90 days use integer bounds that conserve evidence", () => {
  const population = Array.from({ length: 191 }, (_, i) => session({ sessionId: String(i), startedAt: Date.UTC(2025, 0, 1) + i * 86_400_000 + i }));
  const report = buildAnalysisReport(population, population, {}, { generatedAtMs: 1 }, { limit: 1 });
  assert.equal(report.timeBuckets.reduce((sum, bucket) => sum + bucket.sessions, 0), population.length);
  for (const bucket of report.timeBuckets) {
    assert.ok(Number.isInteger(bucket.startMs)); assert.ok(Number.isInteger(bucket.endMs));
    assert.equal(filterAnalysisSessions(population, { fromMs: bucket.startMs, toMs: bucket.endMs }).length, bucket.sessions);
  }
});


test("daily usage buckets share UTC filter boundaries and retain zero-activity gaps", () => {
  const population = [session({ startedAt: Date.parse("2026-09-06T00:15:00Z") }), session({ sessionId: "later", startedAt: Date.parse("2026-09-08T23:15:00Z") })];
  const report = buildAnalysisReport(population, population, {}, { generatedAtMs: 1 }, { limit: 1 });
  assert.deepEqual(report.timeBuckets.map(bucket => bucket.sessions), [1, 0, 1]);
  assert.equal(new Date(report.timeBuckets[0].startMs).toISOString(), "2026-09-06T00:00:00.000Z");
  assert.equal(report.timeBuckets[1].tokens, null);
  assert.equal(report.timeBuckets[1].costUsd, null);
  for (const bucket of report.timeBuckets) assert.equal(filterAnalysisSessions(population, { fromMs: bucket.startMs, toMs: bucket.endMs }).length, bucket.sessions);
});


test("model selection includes attributed secondary models and counts priced coverage once", async () => {
  const mixed = session({ modelUsage: [
    { model: "gpt-5.6-luna", inputTokens: 70, outputTokens: 30, cacheReadTokens: 0, cacheCreateTokens: 0, toolCalls: 3, toolErrors: 1 },
    { model: "gpt-5.5", inputTokens: 30, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0, toolCalls: 1, toolErrors: 0 },
  ] });
  assert.equal(filterAnalysisSessions([mixed], { model: "gpt-5.5" }).length, 1);
  assert.equal(filterAnalysisSessions([mixed], { model: "missing-model" }).length, 0);
  const { aggregate } = await import("../lib/live/aggregate");
  const rows = aggregate([mixed]).byModel;
  for (const row of rows) { assert.equal(row.sessions, 1); assert.equal(row.pricedSessions, 1); }
});


test("recorded zero cost is covered while missing zero cost is unavailable", async () => {
  const { aggregate } = await import("../lib/live/aggregate");
  const measured = session({ costUsd: 0 });
  assert.equal(aggregate([measured]).byModel[0].pricedSessions, 1);
  const missing = session({ costUsd: 0, metricSources: { ...measured.metricSources, cost: "missing" } });
  assert.equal(aggregate([missing]).byModel[0].pricedSessions, 0);
});


test("analysis cache retains exact report semantics and invalidates on snapshot, selection, page and metadata", async () => {
  const { createAnalysisReader } = await import("../lib/collection/analysis-cache");
  const read = createAnalysisReader();
  const rows = [session(), session({ sessionId: "second", model: "model-b" })];
  const meta = { generatedAtMs: 10 };
  const page = { offset: 0, limit: 1 };
  const initial = read(rows, {}, meta, page);
  assert.deepEqual(initial, buildAnalysisReport(rows, rows, {}, meta, page));
  assert.equal(read(rows, {}, meta, page), initial);
  for (const [selection, metadata, paging] of [
    [{ model: "model-b" }, meta, page], [{}, meta, { offset: 1, limit: 1 }],
    [{}, { ...meta, stale: true, refreshing: false, refreshError: "scan failed" }, page],
  ] as const) {
    assert.deepEqual(read(rows, selection, metadata, paging), buildAnalysisReport(rows, filterAnalysisSessions(rows, selection), selection, metadata, paging));
  }
  assert.notEqual(read([...rows], {}, meta, page), initial, "new population with same timestamp invalidates");
  const next = read(rows, {}, { generatedAtMs: 11 }, page);
  assert.equal(next.generation, 11);
  assert.notEqual(next, initial);
  for (let i = 1; i <= 9; i++) read(rows, {}, { generatedAtMs: 11 }, { offset: i, limit: 1 });
  assert.notEqual(read(rows, {}, { generatedAtMs: 11 }, page), next, "oldest page is evicted");
  assert.notEqual(read(rows, {}, meta, { offset: 0, limit: 201 }), read(rows, {}, meta, { offset: 0, limit: 201 }), "unbounded pages bypass cache");
});

test('model options count each attributed identity once while primary groups conserve whole sessions', () => {
  const mixed = session({ model: 'primary', modelUsage: [
    { model: 'primary', inputTokens: 60, outputTokens: 30, cacheReadTokens: 0, cacheCreateTokens: 0, toolCalls: 2, toolErrors: 0 },
    { model: 'secondary', inputTokens: 40, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0, toolCalls: 2, toolErrors: 1 },
  ] });
  const rows = [mixed, session({ sessionId: 'second', model: 'secondary' })];
  const report = buildAnalysisReport(rows, rows, {}, { generatedAtMs: 1 });
  for (const option of report.options.models) assert.equal(option.count, filterAnalysisSessions(rows, { model: option.value }).length);
  assert.equal(report.options.models.find(o => o.value === 'secondary')?.count, 2);
  assert.equal(report.modelGroups.reduce((n, group) => n + group.sessions, 0), 2);
});

test('known free cost, measured zero, placeholder zero and malformed cost remain distinct across analysis and aggregation', async () => {
  const { setOpenRouterCatalogForTests, clearOpenRouterCatalogForTests } = await import('../lib/pricing-catalog');
  const { aggregate } = await import('../lib/live/aggregate');
  setOpenRouterCatalogForTests([{ id: 'fixture/free', pricing: { prompt: 0, completion: 0, input_cache_read: 0, input_cache_write: 0 } }]);
  try {
    const rows = [
      session({ sessionId: 'free', model: 'fixture/free', costUsd: 0, metricSources: { ...session().metricSources, cost: 'inferred' } }),
      session({ sessionId: 'measured', costUsd: 0 }),
      session({ sessionId: 'placeholder', costUsd: 0, metricSources: { ...session().metricSources, cost: 'inferred' } }),
      session({ sessionId: 'malformed', costUsd: 0, metricSources: { ...session().metricSources, cost: 'malformed' } }),
    ];
    const report = buildAnalysisReport(rows, rows, {}, { generatedAtMs: 1 });
    assert.equal(report.usageTotals.measuredCostSessions, 1); assert.equal(report.usageTotals.inferredCostSessions, 1);
    for (const row of report.sessions) assert.equal(row.costUsd, ['free', 'measured'].includes(row.sessionId) ? 0 : null);
    const agg = aggregate(rows);
    assert.equal(agg.usageSummary.sessionsWithPricedUsage, 2);
    assert.equal(agg.byModel.find(m => m.model === 'fixture/free')?.pricedSessions, 1);
  } finally { clearOpenRouterCatalogForTests(); }
});
