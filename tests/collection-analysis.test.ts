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
