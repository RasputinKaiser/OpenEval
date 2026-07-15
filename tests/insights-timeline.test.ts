import test from "node:test";
import assert from "node:assert/strict";
import { scoreOutcome } from "../lib/insights/outcome";
import { toPoints, detectMarkers, metricSeries, markerImpact } from "../lib/insights/timeline";
import type { LiveSession, OutcomeSignals } from "../lib/live";
import type { StoredJudgment } from "../lib/live-cache";

function session(over: Partial<LiveSession> & { startedAt: number }): LiveSession & { sourceLabel: string } {
  const sig: OutcomeSignals = { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 };
  return {
    sessionId: "s" + over.startedAt, displayTitle: null, lastPromptPreview: null, project: "/p", model: "claude-opus-4-8",
    lastEventAt: over.startedAt, durationMs: 60000,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0, costUsd: 0,
    usageSegments: [], toolCalls: 0, toolErrors: 0, numTurns: 1, stopReason: null, isError: false,
    pathBytes: 0, lineCount: 0, malformedLineCount: 0, thinkingBlocks: 0, textBlocks: 0, attachmentCount: 0,
    queueOperationCount: 0, snapshotCount: 0, hookErrors: 0, messageCount: 1, userType: null, dataQuality: 1,
    metricSources: { model: "measured", tokens: "measured", cost: "inferred", duration: "measured", turns: "measured" },
    parseWarnings: [], toolErrorRate: 0, toolCallsPerTurn: 0, textAvailability: 0, staleMs: 0,
    traceGraph: { rootMessages: 0, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [], toolDurations: [], queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [], mcpServersUsed: [], subagentSpawns: 0, cliVersion: null,
    sourceLabel: "Claude Code",
    ...over,
    outcomeSignals: { ...sig, ...(over.outcomeSignals ?? {}) },
  };
}

test("scoreOutcome: praise lifts, correction drops, neutral stays ~0.5", () => {
  const pos = scoreOutcome(session({ startedAt: 1, outcomeSignals: { userPositive: 2 } as OutcomeSignals }));
  const neg = scoreOutcome(session({ startedAt: 1, outcomeSignals: { userNegative: 2, errorTail: true } as OutcomeSignals }));
  const neu = scoreOutcome(session({ startedAt: 1 }));
  assert.ok(pos.score > 0.55 && pos.score <= 1);
  assert.ok(neg.score < 0.45 && neg.score >= 0);
  assert.equal(neu.score, 0.5);
  assert.equal(neu.hasSignal, false);
  assert.equal(pos.hasSignal, true);
  assert.ok(pos.reasons.length > 0);
});

test("toPoints orders by time and flattens fields", () => {
  const pts = toPoints([session({ startedAt: 300 }), session({ startedAt: 100 }), session({ startedAt: 200 })]);
  assert.deepEqual(pts.map((p) => p.at), [100, 200, 300]);
  assert.equal(pts[0].source, "Claude Code");
});

test("detectMarkers records first-seen and usage counts", () => {
  const pts = toPoints([
    session({ startedAt: 100, skillsUsed: ["brainstorming"] }),
    session({ startedAt: 200, skillsUsed: ["brainstorming"], mcpServersUsed: ["spokenly"] }),
    session({ startedAt: 300, subagentSpawns: 3 }),
  ]);
  const markers = detectMarkers(pts);
  const brainstorm = markers.find((m) => m.name === "brainstorming");
  assert.equal(brainstorm?.firstSeenAt, 100);
  assert.equal(brainstorm?.sessionCount, 2);
  assert.equal(markers.find((m) => m.name === "spokenly")?.firstSeenAt, 200);
  assert.equal(markers.find((m) => m.kind === "subagent")?.firstSeenAt, 300);
});

test("metricSeries computes a trailing-window median", () => {
  const pts = toPoints([1, 2, 3, 4, 5].map((v) => session({ startedAt: v * 100, costUsd: v })));
  const s = metricSeries(pts, (p) => p.costUsd, 3);
  assert.equal(s.length, 5);
  assert.equal(s[0].value, 1); // [1]
  assert.equal(s[2].value, 2); // median [1,2,3]
  assert.equal(s[4].value, 4); // median [3,4,5]
});

test("markerImpact compares before/after and flags a model-switch confound", () => {
  const pts = toPoints([
    ...[1, 2, 3, 4, 5, 6].map((v) => session({ startedAt: v, model: "claude-opus-4-8", toolErrorRate: 0.4 })),
    ...[7, 8, 9, 10, 11, 12].map((v) => session({ startedAt: v, model: "claude-fable-5", toolErrorRate: 0.1, skillsUsed: ["planning"] })),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "planning")!;
  const impact = markerImpact(pts, marker, 10, 3);
  assert.ok(impact.nBefore >= 3 && impact.nAfter >= 3);
  assert.ok(impact.deltas.toolErrorRate < 0); // error rate dropped after
  assert.ok(impact.confounds.some((c) => /model changed/.test(c))); // opus → fable flagged
});

const POOL_MIX = /outcome medians mix/;

function judgmentsFor(files: string[], score: number): Map<string, StoredJudgment> {
  return new Map(files.map((file) => [file, {
    file, sessionId: null, mtimeMs: 0, score, reasons: ["judge verdict"], judge: "test/judge", judgedAt: 0, promptVersion: 2,
  }]));
}

// 6 sessions before the "planning" marker (at=7) and 6 after, all on one model.
function poolMixPoints(judgments?: Map<string, StoredJudgment>) {
  const sessions = [
    ...[1, 2, 3, 4, 5, 6].map((v) => session({ startedAt: v, path: `/t/${v}.jsonl` })),
    ...[7, 8, 9, 10, 11, 12].map((v) => session({ startedAt: v, path: `/t/${v}.jsonl`, skillsUsed: ["planning"] })),
  ];
  const pts = toPoints(sessions, judgments);
  const marker = detectMarkers(pts).find((m) => m.name === "planning")!;
  return { pts, marker };
}

test("markerImpact: both sides heuristic → no pool-mix confound", () => {
  const { pts, marker } = poolMixPoints();
  const impact = markerImpact(pts, marker, 10, 3);
  assert.equal(impact.judgedBefore, 0);
  assert.equal(impact.judgedAfter, 0);
  assert.ok(!impact.confounds.some((c) => POOL_MIX.test(c)));
});

test("markerImpact flags judged-vs-heuristic pool asymmetry as a confound", () => {
  const { pts, marker } = poolMixPoints(judgmentsFor(["7", "8", "9", "10", "11", "12"].map((v) => `/t/${v}.jsonl`), 0.9));
  const impact = markerImpact(pts, marker, 10, 3);
  assert.equal(impact.judgedBefore, 0);
  assert.equal(impact.judgedAfter, 6);
  assert.ok(impact.confounds.some((c) => POOL_MIX.test(c)));
  assert.ok(impact.confounds.some((c) => c.includes("judged (after)") && c.includes("heuristic (before)")));
});

test("markerImpact: both sides judged → no pool-mix confound", () => {
  const { pts, marker } = poolMixPoints(judgmentsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((v) => `/t/${v}.jsonl`), 0.7));
  const impact = markerImpact(pts, marker, 10, 3);
  assert.equal(impact.judgedBefore, 6);
  assert.equal(impact.judgedAfter, 6);
  assert.ok(!impact.confounds.some((c) => POOL_MIX.test(c)));
});

test("markerImpact flags thin samples as low confidence", () => {
  const pts = toPoints([
    session({ startedAt: 1 }),
    session({ startedAt: 2, skillsUsed: ["rare"] }),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "rare")!;
  const impact = markerImpact(pts, marker, 20, 5);
  assert.equal(impact.lowConfidence, true);
  assert.ok(impact.confounds.some((c) => /thin sample/.test(c)));
});
