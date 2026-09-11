import { performance } from "node:perf_hooks";
import type { CollectedSession } from "../../lib/collection/aggregate";
import { buildAnalysisReport, filterAnalysisSessions } from "../../lib/collection/analysis";
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

const population = Array.from({ length: 12000 }, (_, i) => session({ sessionId: String(i), startedAt: Date.UTC(2025, 0, 1) + i * 2160000, model: i % 2 ? "model-a" : "model-b" }));
const samples: number[] = []; let payloadBytes = 0;
for (let i = 0; i < 33; i++) {
  const start = performance.now();
  const selected = filterAnalysisSessions(population, i % 2 ? { model: "model-a" } : {});
  const report = buildAnalysisReport(population, selected, {}, { generatedAtMs: 1 }, { limit: 80 });
  if (i >= 3) samples.push(performance.now() - start);
  payloadBytes = Buffer.byteLength(JSON.stringify(report));
}
samples.sort((a,b) => a-b);
console.log(JSON.stringify({ workload: "12000 sessions across 300 days; alternate all/model filter; 3 warmups, 30 requests", medianMs: samples[15], p95Ms: samples[28], responseBytes: payloadBytes }));
