import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTimeline } from "../lib/insights/collect";
import type { LiveSession, OutcomeSignals } from "../lib/live";

const ROOT = path.join(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function session(startedAt: number, outcomeSignals?: Partial<OutcomeSignals>): LiveSession & { sourceLabel: string } {
  return {
    sessionId: `quality-${startedAt}`,
    displayTitle: null,
    lastPromptPreview: null,
    project: "/quality",
    model: "test-model",
    startedAt,
    lastEventAt: startedAt,
    durationMs: 60_000,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    usageSegments: [],
    toolCalls: 0,
    toolErrors: 0,
    numTurns: 1,
    stopReason: null,
    isError: false,
    pathBytes: 0,
    lineCount: 0,
    malformedLineCount: 0,
    thinkingBlocks: 0,
    textBlocks: 0,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount: 1,
    userType: null,
    dataQuality: 1,
    metricSources: { model: "measured", tokens: "measured", cost: "missing", duration: "measured", turns: "measured" },
    parseWarnings: [],
    toolErrorRate: 0,
    toolCallsPerTurn: 0,
    textAvailability: 0,
    staleMs: 0,
    traceGraph: { rootMessages: 0, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [],
    toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion: null,
    sourceLabel: "Quality fixture",
    outcomeSignals: {
      userPositive: 0,
      userNegative: 0,
      rephrases: 0,
      errorTail: false,
      testsPassedTail: false,
      reworkFiles: 0,
      ...outcomeSignals,
    },
  };
}

test("timeline evidence keeps source denominator separate from downsampled chart points", () => {
  const report = buildTimeline([
    ...Array.from({ length: 100 }, (_, index) => session(index + 1, { userPositive: 1 })),
    ...Array.from({ length: 20 }, (_, index) => session(index + 101)),
  ]);

  assert.deepEqual(report.outcomeSeriesEvidence, {
    n: 100,
    denominator: 120,
    coverage: 100 / 120,
    pool: "signal",
    provenance: "heuristic",
  });
  assert.equal(report.outcomeSeries.length, 80, "the chart is downsampled without changing its source denominator");
  assert.equal(report.signalSessions, 100);
  assert.equal(report.noSignalSessions, 20);
});

test("timeline evidence marks an empty signal pool as unavailable", () => {
  const report = buildTimeline([session(1), session(2)]);

  assert.deepEqual(report.outcomeSeriesEvidence, {
    n: 0,
    denominator: 2,
    coverage: 0,
    pool: "signal",
    provenance: "unavailable",
  });
  assert.deepEqual(report.outcomeSeries, []);
});

test("chart surfaces expose evidence basis and truthful no-data states", () => {
  const outcomeChart = read("components/OutcomeChart.tsx");
  assert.match(outcomeChart, /LLM-judged sessions only/);
  assert.match(outcomeChart, /source n=\$\{evidence\.n\}\/\$\{evidence\.denominator\} top-level/);
  assert.match(outcomeChart, /source denominator unavailable in this snapshot/);

  const timeline = read("components/TimelineClient.tsx");
  assert.match(timeline, /outcomeSeriesEvidence/);
  assert.match(timeline, /evidence=\{seriesEvidence\}/);
  assert.match(timeline, /points are plotted after downsampling/);

  const collectionCharts = read("components/CollectionCharts.tsx");
  assert.match(collectionCharts, /No weekly usage evidence in this snapshot/);
  assert.match(collectionCharts, /No session-start evidence in this snapshot/);
  assert.match(collectionCharts, /No tool-call evidence in this snapshot/);
  assert.match(collectionCharts, /metric === "cost" && windowEstimated/);
});
