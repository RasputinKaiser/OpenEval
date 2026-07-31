import test from "node:test";
import assert from "node:assert/strict";
import { scoreOutcome } from "../lib/insights/outcome";
import { toPoints, detectMarkers, metricSeries, markerImpact } from "../lib/insights/timeline";
import { buildTimeline } from "../lib/insights/collect";
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

test("scoreOutcome ignores malformed numeric signals without emitting NaN", () => {
  const result = scoreOutcome(session({
    startedAt: 1,
    toolErrorRate: Number.NaN,
    outcomeSignals: {
      userPositive: Number.NaN,
      userNegative: Number.POSITIVE_INFINITY,
      rephrases: -4,
      reworkFiles: Number.NaN,
    } as OutcomeSignals,
  }));
  assert.equal(result.score, 0.5);
  assert.equal(result.hasSignal, false);
  assert.ok(Number.isFinite(result.score));
});

test("toPoints orders by time and flattens fields", () => {
  const pts = toPoints([session({ startedAt: 300 }), session({ startedAt: 100 }), session({ startedAt: 200 })]);
  assert.deepEqual(pts.map((p) => p.at), [100, 200, 300]);
  assert.equal(pts[0].source, "Claude Code");
});

test("buildTimeline keeps child traces out of human outcome denominators", () => {
  const report = buildTimeline([
    session({ startedAt: 100, sessionId: "parent", skillsUsed: ["shared-skill"], outcomeSignals: { userPositive: 1 } as OutcomeSignals }),
    session({ startedAt: 150, sessionId: "child-with-parent-id", parentSessionId: "parent", skillsUsed: ["shared-skill", "child-only-skill"], outcomeSignals: { userNegative: 3 } as OutcomeSignals }),
    session({ startedAt: 200, sessionId: "child", isSubagent: true, parentSessionId: "parent", skillsUsed: ["child-only-skill"], outcomeSignals: { userNegative: 3 } as OutcomeSignals }),
  ]);
  assert.equal(report.totalSessions, 1);
  assert.equal(report.excludedSubagentSessions, 2);
  assert.equal(report.signalSessions, 1);
  const childOnly = report.markers.find((marker) => marker.name === "child-only-skill");
  assert.equal(childOnly?.firstSeenAt, 150);
  assert.equal(childOnly?.sessionCount, 0, "child traces never enter the top-level marker denominator");
  assert.equal(childOnly?.evidenceSessionCount, 2);
  assert.equal(childOnly?.childSessionCount, 2);
  assert.equal(childOnly?.observedIn, "child");
  assert.equal(report.markers.find((marker) => marker.name === "shared-skill")?.observedIn, "both");
  assert.equal(report.impacts.some((impact) => impact.marker.name === "child-only-skill"), false);
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

test("markerImpact: both sides use available signal → no pool-mix confound", () => {
  const { pts, marker } = poolMixPoints();
  const impact = markerImpact(pts, marker, 10, 3);
  assert.equal(impact.judgedBefore, 0);
  assert.equal(impact.judgedAfter, 0);
  assert.ok(!impact.confounds.some((c) => POOL_MIX.test(c)));
});

test("markerImpact flags judged-vs-signal pool asymmetry as a confound", () => {
  const { pts, marker } = poolMixPoints(judgmentsFor(["7", "8", "9", "10", "11", "12"].map((v) => `/t/${v}.jsonl`), 0.9));
  const impact = markerImpact(pts, marker, 10, 3);
  assert.equal(impact.judgedBefore, 0);
  assert.equal(impact.judgedAfter, 6);
  assert.ok(impact.confounds.some((c) => POOL_MIX.test(c)));
  assert.ok(impact.confounds.some((c) => c.includes("judged (after)") && c.includes("signal (before)")));
});

test("markerImpact: both sides judged → no pool-mix confound", () => {
  const { pts, marker } = poolMixPoints(judgmentsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((v) => `/t/${v}.jsonl`), 0.7));
  const impact = markerImpact(pts, marker, 10, 3);
  assert.equal(impact.judgedBefore, 6);
  assert.equal(impact.judgedAfter, 6);
  assert.ok(!impact.confounds.some((c) => POOL_MIX.test(c)));
});

test("markerImpact effect size uses the same judged-only pool as its medians", () => {
  const sessions = [
    ...Array.from({ length: 10 }, (_, i) => session({ startedAt: i + 1, path: `/t/${i + 1}.jsonl` })),
    ...Array.from({ length: 10 }, (_, i) => session({ startedAt: i + 11, path: `/t/${i + 11}.jsonl`, skillsUsed: ["judged-skill"] })),
  ];
  const judgedBefore = Array.from({ length: 5 }, (_, i) => `/t/${i + 1}.jsonl`);
  const judgedAfter = Array.from({ length: 5 }, (_, i) => `/t/${i + 11}.jsonl`);
  const points = toPoints(sessions, new Map([
    ...judgmentsFor(judgedBefore, 0.2),
    ...judgmentsFor(judgedAfter, 0.8),
  ]));
  const marker = detectMarkers(points).find((m) => m.name === "judged-skill")!;
  const impact = markerImpact(points, marker, 10, 5);

  assert.equal(impact.outcomePoolBefore, "judged");
  assert.equal(impact.outcomePoolAfter, "judged");
  assert.equal(impact.effectSize, null, "constant judged-only sides have no finite pooled variance");
  assert.equal(impact.strength, "large", "the raw judged median shift remains explicit when variance is zero");
});

test("markerImpact flags thin samples as low confidence", () => {
  const pts = toPoints([
    session({ startedAt: 1 }),
    session({ startedAt: 2, skillsUsed: ["rare"] }),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "rare")!;
  const impact = markerImpact(pts, marker, 20, 5);
  assert.equal(impact.lowConfidence, true);
  assert.ok(impact.confounds.some((c) => /thin window/.test(c)));
});

test("markerImpact distinguishes full windows from the outcome denominator", () => {
  const pts = toPoints([
    ...[1, 2, 3, 4, 5, 6].map((startedAt) => session({ startedAt })),
    ...[7, 8, 9, 10, 11, 12].map((startedAt) => session({
      startedAt,
      skillsUsed: ["signal-after"],
      outcomeSignals: { userPositive: 1 } as OutcomeSignals,
    })),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "signal-after")!;
  const impact = markerImpact(pts, marker, 10, 3);

  assert.deepEqual([impact.nBefore, impact.nAfter], [6, 6]);
  assert.deepEqual([impact.signalBefore, impact.signalAfter], [0, 6]);
  assert.deepEqual([impact.outcomeNBefore, impact.outcomeNAfter], [0, 6]);
  assert.equal(impact.outcomeComparable, false);
  assert.ok(impact.confounds.some((c) => /outcome unavailable/.test(c)));
});

test("markerImpact marks one-sided windows as unavailable for every delta", () => {
  const pts = toPoints([
    ...[1, 2, 3, 4, 5, 6].map((startedAt) => session({ startedAt, skillsUsed: ["first-session"] })),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "first-session")!;
  const impact = markerImpact(pts, marker, 20, 5);
  assert.equal(impact.nBefore, 0);
  assert.equal(impact.nAfter, 6);
  assert.equal(impact.windowComparable, false);
  assert.ok(impact.confounds.some((c) => /comparison window unavailable/.test(c)));
});

test("buildTimeline exposes exact signal, judged, heuristic, and no-signal counts", () => {
  const report = buildTimeline([
    session({ startedAt: 1 }),
    session({ startedAt: 2, outcomeSignals: { userPositive: 1 } as OutcomeSignals }),
    session({ startedAt: 3, outcomeSignals: { userNegative: 1 } as OutcomeSignals }),
  ]);

  assert.equal(report.totalSessions, 3);
  assert.equal(report.signalSessions, 2);
  assert.equal(report.judgedSessions, 0);
  assert.equal(report.heuristicSignalSessions, 2);
  assert.equal(report.noSignalSessions, 1);
  assert.equal(report.signalCoverage, 2 / 3);
});

test("buildTimeline keeps overall trend unavailable until both homogeneous halves are thick enough", () => {
  const none = buildTimeline([session({ startedAt: 1 }), session({ startedAt: 2 })]);
  assert.equal(none.overall.comparable, false);
  assert.deepEqual([none.overall.firstHalfN, none.overall.secondHalfN], [0, 0]);
  assert.equal(none.overall.trend, 0);

  const one = buildTimeline([session({ startedAt: 1, outcomeSignals: { userPositive: 1 } as OutcomeSignals })]);
  assert.equal(one.overall.comparable, false);
  assert.deepEqual([one.overall.firstHalfN, one.overall.secondHalfN], [0, 1]);

  const two = buildTimeline([
    session({ startedAt: 1, outcomeSignals: { userPositive: 1 } as OutcomeSignals }),
    session({ startedAt: 2, outcomeSignals: { userNegative: 1 } as OutcomeSignals }),
  ]);
  assert.equal(two.overall.comparable, false);
  assert.deepEqual([two.overall.firstHalfN, two.overall.secondHalfN], [1, 1]);

  const ten = buildTimeline([
    ...Array.from({ length: 5 }, (_, i) => session({ startedAt: i + 1, outcomeSignals: { userPositive: 1 } as OutcomeSignals })),
    ...Array.from({ length: 5 }, (_, i) => session({ startedAt: i + 6, outcomeSignals: { userNegative: 1 } as OutcomeSignals })),
  ]);
  assert.equal(ten.overall.comparable, true);
  assert.equal(ten.overall.outcomeProvenance, "heuristic");
  assert.deepEqual([ten.overall.firstHalfN, ten.overall.secondHalfN], [5, 5]);
  assert.notEqual(ten.overall.trend, 0);
});

test("toPoints distinguishes unavailable outcomes and measured-zero cost from inferred zero", () => {
  const [neutral, measuredZero, inferredZero] = toPoints([
    session({ startedAt: 1, metricSources: { model: "measured", tokens: "measured", cost: "missing", duration: "measured", turns: "measured" } }),
    session({ startedAt: 2, costUsd: 0, metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" } }),
    session({ startedAt: 3, costUsd: 0, metricSources: { model: "measured", tokens: "measured", cost: "inferred", duration: "measured", turns: "measured" } }),
  ]);
  assert.equal(neutral.outcomeProvenance, "unavailable");
  assert.equal(measuredZero.costAvailable, true);
  assert.equal(measuredZero.costUsd, 0);
  assert.equal(inferredZero.costAvailable, false);
});

test("detectMarkers deduplicates repeated names within one trace", () => {
  const [marker] = detectMarkers(toPoints([
    session({ startedAt: 1, skillsUsed: ["repeat", "repeat", "repeat"], mcpServersUsed: ["mcp", "mcp"] }),
  ])).filter((m) => m.kind === "skill");
  assert.equal(marker?.sessionCount, 1);
  assert.equal(marker?.evidenceSessionCount, 1);
});

test("markerImpact with thin evidence exposes provenance, comparability, and no effect size", () => {
  const pts = toPoints([
    ...Array.from({ length: 2 }, (_, i) => session({ startedAt: i + 1, outcomeSignals: { userPositive: 1 } as OutcomeSignals })),
    ...Array.from({ length: 2 }, (_, i) => session({ startedAt: i + 3, skillsUsed: ["thin"], outcomeSignals: { userNegative: 1 } as OutcomeSignals })),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "thin")!;
  const impact = markerImpact(pts, marker, 20, 5);
  assert.equal(impact.outcomeComparable, false);
  assert.equal(impact.comparability, "thin");
  assert.equal(impact.effectSize, null);
  assert.equal(impact.beforeEvidence.outcome.n, 2);
  assert.equal(impact.afterEvidence.outcome.n, 2);
});

test("markerImpact reports measured cost per session, including exact zero", () => {
  const pts = toPoints([
    ...Array.from({ length: 5 }, (_, i) => session({ startedAt: i + 1, costUsd: 0, metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" } })),
    ...Array.from({ length: 5 }, (_, i) => session({ startedAt: i + 6, costUsd: 2, skillsUsed: ["cost-aware"], metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" } })),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "cost-aware")!;
  const impact = markerImpact(pts, marker, 5, 5);
  assert.equal(impact.before.costUsd, 0);
  assert.equal(impact.after.costUsd, 2);
  assert.equal(impact.beforeEvidence.costUsd.n, 5);
  assert.equal(impact.afterEvidence.costUsd.n, 5);
  assert.equal(impact.metricComparable.costUsd, true);
});
