import test from "node:test";
import assert from "node:assert/strict";
import { buildRollup, weekStart } from "../lib/collection/rollup";
import { detectChangePoints } from "../lib/insights/changepoints";
import { toPoints, detectMarkers } from "../lib/insights/timeline";
import type { LiveSession, OutcomeSignals } from "../lib/live";

function session(over: Partial<LiveSession> & { startedAt: number }): LiveSession & { sourceLabel: string } {
  const sig: OutcomeSignals = { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 };
  return {
    sessionId: "s" + over.startedAt, displayTitle: null, lastPromptPreview: null, project: "/p", model: "claude-opus-4-8",
    lastEventAt: over.startedAt, durationMs: 60000,
    inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 110, costUsd: 1,
    usageSegments: [], toolCalls: 2, toolErrors: 0, numTurns: 1, stopReason: null, isError: false,
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
    path: "/sessions/s" + over.startedAt + ".jsonl",
    ...over,
    outcomeSignals: { ...sig, ...(over.outcomeSignals ?? {}) },
  };
}

// ---- rollup ----

test("weekStart returns Monday 00:00 of the containing week", () => {
  // 2026-07-08 is a Wednesday → week starts Monday 2026-07-06.
  const wed = new Date(2026, 6, 8, 15, 30).getTime();
  const start = new Date(weekStart(wed));
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 6);
  assert.equal(start.getHours(), 0);
  // A Monday is its own week start.
  const mon = new Date(2026, 6, 6, 9, 0).getTime();
  assert.equal(weekStart(mon), start.getTime());
});

test("buildRollup buckets sessions by week and ranks projects by cost", (t) => {
  // Pin the vantage mid-week (Wed 2026-07-15) so "now - 8 days" always lands
  // in the previous weekly bucket regardless of wall clock or DST.
  const now = new Date(2026, 6, 15, 12, 0).getTime();
  t.mock.method(Date, "now", () => now);
  const sessions = [
    session({ startedAt: now, costUsd: 5, project: "/a" }),
    session({ startedAt: now - 1000, costUsd: 3, project: "/b" }),
    session({ startedAt: now - 8 * 86_400_000, costUsd: 2, project: "/a" }), // last week
    session({ startedAt: now - 400 * 86_400_000, costUsd: 99, project: "/old" }), // outside window
  ];
  const r = buildRollup(sessions, { weeks: 4 });
  assert.equal(r.weekly.length, 4);
  const thisWeek = r.weekly[r.weekly.length - 1];
  assert.equal(thisWeek.sessions, 2);
  assert.equal(thisWeek.costUsd, 8);
  const lastWeek = r.weekly[r.weekly.length - 2];
  assert.equal(lastWeek.sessions, 1);
  // /old is outside the weekly window but still ranks in projects (all-time).
  assert.equal(r.byProject[0].project, "/old");
  assert.equal(r.byProject[1].project, "/a");
  assert.equal(r.byProject[1].costUsd, 7);
  assert.equal(r.anyEstimatedCost, true);
});

test("buildRollup keeps sessions on the far side of a DST transition", (t) => {
  const realTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // Vantage: Wed 2026-12-16 (EST). Session: Wed 2026-10-21 (EDT), 8 weeks
    // back across the Nov 1 fall-back. Fixed 7*86400000 stepping put bucket
    // keys an hour off local Monday midnight past the transition, so the
    // session's weekStart missed every key and it vanished from the chart.
    const now = new Date(2026, 11, 16, 12, 0).getTime();
    t.mock.method(Date, "now", () => now);
    const s = session({ startedAt: new Date(2026, 9, 21, 12, 0).getTime() });
    const r = buildRollup([s], { weeks: 12 });
    for (const b of r.weekly) {
      const d = new Date(b.startMs);
      assert.equal(d.getDay(), 1, `bucket ${d.toISOString()} starts on Monday`);
      assert.equal(d.getHours(), 0, `bucket ${d.toISOString()} starts at local midnight`);
    }
    assert.equal(r.weekly.reduce((a, b) => a + b.sessions, 0), 1, "pre-DST session is bucketed");
    const target = r.weekly.find((b) => b.startMs === weekStart(s.startedAt));
    assert.equal(target?.sessions, 1);
  } finally {
    if (realTZ === undefined) delete process.env.TZ;
    else process.env.TZ = realTZ;
  }
});

// ---- change points ----

test("detectChangePoints finds a step shift and attributes a nearby marker", () => {
  const DAY = 86_400_000;
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const sessions = [];
  for (let i = 0; i < 80; i++) {
    // Tool-error rate steps from 5% to 40% at i=40; a skill is adopted right there.
    sessions.push(session({
      startedAt: t0 + i * DAY,
      toolErrorRate: i < 40 ? 0.05 : 0.4,
      skillsUsed: i >= 40 ? ["new-linter"] : [],
    }));
  }
  const points = toPoints(sessions);
  const markers = detectMarkers(points);
  const cps = detectChangePoints(points, markers, { window: 20 });
  const errShift = cps.find((c) => c.metric === "toolErrorRate");
  assert.ok(errShift, "expected a toolErrorRate change point");
  assert.ok(Math.abs(errShift!.at - (t0 + 40 * DAY)) <= 3 * DAY, "shift located near the true step");
  assert.ok(errShift!.after > errShift!.before);
  assert.ok(errShift!.nearMarkers.some((m) => m.includes("new-linter")), "adopted skill listed as suspect");
});

test("detectChangePoints stays quiet on a flat series", () => {
  const DAY = 86_400_000;
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const sessions = [];
  for (let i = 0; i < 80; i++) {
    sessions.push(session({ startedAt: t0 + i * DAY, toolErrorRate: 0.1, costUsd: 1 }));
  }
  const points = toPoints(sessions);
  const cps = detectChangePoints(points, [], { window: 20 });
  assert.equal(cps.length, 0);
});

test("buildRollup heatmap counts session starts by weekday/hour, Monday-first", () => {
  // 2026-07-08 is a Wednesday (row 2), 15:xx (col 15); 2026-07-06 a Monday 09:xx.
  const sessions = [
    session({ startedAt: new Date(2026, 6, 8, 15, 30).getTime() }),
    session({ startedAt: new Date(2026, 6, 8, 15, 45).getTime() }),
    session({ startedAt: new Date(2026, 6, 6, 9, 0).getTime() }),
  ];
  const r = buildRollup(sessions, { weeks: 2 });
  assert.equal(r.heatmap.length, 7);
  assert.equal(r.heatmap[0].length, 24);
  assert.equal(r.heatmap[2][15], 2);
  assert.equal(r.heatmap[0][9], 1);
  assert.equal(r.heatmapSessions, 3);
  assert.equal(r.heatmap.flat().reduce((a, b) => a + b, 0), 3);
});
