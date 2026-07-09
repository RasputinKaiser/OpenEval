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

test("buildRollup buckets sessions by week and ranks projects by cost", () => {
  const now = Date.now();
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
