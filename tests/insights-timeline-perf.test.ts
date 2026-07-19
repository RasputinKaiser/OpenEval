import test from "node:test";
import assert from "node:assert/strict";
import { toPoints, detectMarkers, metricSeries, markerImpact, type SessionPoint } from "../lib/insights/timeline";
import type { LiveSession, OutcomeSignals } from "../lib/live";

function session(over: Partial<LiveSession> & { startedAt: number }): LiveSession & { sourceLabel: string } {
  const sig: OutcomeSignals = { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 };
  return {
    sessionId: "s" + over.startedAt + "-" + Math.random().toString(36).slice(2, 6),
    displayTitle: null, lastPromptPreview: null, project: "/p", model: "claude-opus-4-8",
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

// mulberry32 — deterministic PRNG for the equivalence sweeps
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("markerImpact boundary: points exactly at firstSeenAt land in `after`, not `before`", () => {
  // Adoption at t=500; two sessions share that exact timestamp (one without the
  // skill) — the `at >= firstSeenAt` side must absorb every tied point.
  const pts = toPoints([
    session({ startedAt: 100, costUsd: 1 }),
    session({ startedAt: 200, costUsd: 1 }),
    session({ startedAt: 300, costUsd: 1 }),
    session({ startedAt: 500, costUsd: 9 }), // tied with adoption, no skill
    session({ startedAt: 500, costUsd: 9, skillsUsed: ["boundary-skill"] }),
    session({ startedAt: 600, costUsd: 9, skillsUsed: ["boundary-skill"] }),
    session({ startedAt: 700, costUsd: 9, skillsUsed: ["boundary-skill"] }),
  ]);
  const marker = detectMarkers(pts).find((m) => m.name === "boundary-skill")!;
  assert.equal(marker.firstSeenAt, 500);
  const impact = markerImpact(pts, marker, 20, 3);
  assert.equal(impact.nBefore, 3); // 100, 200, 300 only
  assert.equal(impact.nAfter, 4); // both t=500 points plus 600, 700
  assert.equal(impact.before.costUsd, 1);
  assert.equal(impact.after.costUsd, 9);
});

test("markerImpact matches the filter-based reference on a randomized corpus", () => {
  const r = rng(42);
  const sessions = [];
  for (let i = 0; i < 400; i++) {
    // Coarse buckets force many duplicate timestamps at marker boundaries.
    sessions.push(session({
      startedAt: 1000 + Math.floor(r() * 80) * 50,
      costUsd: r() * 5,
      toolErrorRate: r() * 0.5,
      skillsUsed: r() < 0.3 ? [`sk-${Math.floor(r() * 12)}`] : [],
      subagentSpawns: r() < 0.2 ? 1 : 0,
    }));
  }
  const pts = toPoints(sessions);
  const reference = (points: SessionPoint[], firstSeenAt: number, window: number) => ({
    before: points.filter((p) => p.at < firstSeenAt).slice(-window),
    after: points.filter((p) => p.at >= firstSeenAt).slice(0, window),
  });
  for (const marker of detectMarkers(pts)) {
    for (const window of [0, 1, 5, 20]) {
      const impact = markerImpact(pts, marker, window, 3);
      const ref = reference(pts, marker.firstSeenAt, window);
      assert.equal(impact.nBefore, ref.before.length, `${marker.name} w=${window} before`);
      assert.equal(impact.nAfter, ref.after.length, `${marker.name} w=${window} after`);
      assert.deepEqual(
        [impact.judgedBefore, impact.judgedAfter],
        [ref.before.filter((p) => p.outcomeProvenance === "judged").length,
         ref.after.filter((p) => p.outcomeProvenance === "judged").length],
      );
    }
  }
});

test("metricSeries matches the naive slice-median reference on a randomized corpus", () => {
  const r = rng(7);
  const sessions = [];
  for (let i = 0; i < 300; i++) {
    sessions.push(session({ startedAt: 1000 + Math.floor(r() * 200) * 10, costUsd: r() * 10 }));
  }
  const pts = toPoints(sessions);
  const median = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  for (const window of [0, 1, 3, 15, 1000]) {
    const got = metricSeries(pts, (p) => p.costUsd, window);
    const want = pts.map((p, i) => {
      const slice = pts.slice(Math.max(0, i - window + 1), i + 1).map((q) => q.costUsd);
      return { at: p.at, value: median(slice), n: slice.length };
    });
    assert.deepEqual(got, want, `window=${window}`);
  }

  // NaN metric values must take the recompute fallback and still match the
  // naive reference — including windows where NaNs enter and later leave.
  const nanPick = (p: SessionPoint) => (p.costUsd < 2 ? NaN : p.costUsd);
  for (const window of [3, 15]) {
    const got = metricSeries(pts, nanPick, window);
    const want = pts.map((p, i) => {
      const slice = pts.slice(Math.max(0, i - window + 1), i + 1).map(nanPick);
      return { at: p.at, value: median(slice), n: slice.length };
    });
    assert.ok(got.some((s) => Number.isNaN(s.value)), `window=${window} exercises NaN windows`);
    assert.ok(got.some((s, i) => i > window && !Number.isNaN(s.value)), `window=${window} recovers after NaNs leave`);
    assert.deepEqual(got, want, `window=${window} with NaN values`);
  }
});
