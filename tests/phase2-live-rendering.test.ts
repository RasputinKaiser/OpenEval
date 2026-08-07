import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DRAWER_USAGE_POINT_LIMIT,
  FILTER_MODES,
  decimateUsageSegments,
  fmt,
  formatAvailableMetric,
  fmtMs,
  fmtUsd,
  mergeAggregate,
  nextSessionWindowSize,
  SESSION_WINDOW_SIZE,
  windowSessions,
} from "../components/live/live-shared";
import { appendUsageSegment, MAX_USAGE_SEGMENTS } from "../lib/live";

test("online usage accumulation stays bounded while preserving deltas and endpoint", () => {
  const segments: Array<{ atMs: number; cumulativeInput: number; cumulativeOutput: number; deltaInput: number; deltaOutput: number; outTokPerSec: number }> = [];
  for (let index = 0; index < 20_000; index++) {
    appendUsageSegment(segments, {
      atMs: index,
      cumulativeInput: index + 1,
      cumulativeOutput: index + 1,
      deltaInput: 1,
      deltaOutput: 1,
      outTokPerSec: 1,
    });
  }
  assert.ok(segments.length <= MAX_USAGE_SEGMENTS * 8 + 1);
  assert.equal(segments.at(-1)?.cumulativeOutput, 20_000);
  assert.equal(segments.reduce((sum, segment) => sum + segment.deltaOutput, 0), 20_000);
});

test("Live session windowing is deterministic and bounded", () => {
  const sessions = Array.from({ length: 1_800 }, (_, index) => index);
  assert.deepEqual(windowSessions(sessions), sessions.slice(0, SESSION_WINDOW_SIZE));
  assert.equal(windowSessions(sessions, 125).length, 125);
  assert.equal(nextSessionWindowSize(SESSION_WINDOW_SIZE, sessions.length), 50);
  assert.equal(nextSessionWindowSize(1_790, sessions.length), sessions.length);
});

test("Live usage renders measured zero separately from missing evidence", () => {
  assert.equal(formatAvailableMetric(0, 1, (value) => String(value)), "0");
  assert.equal(formatAvailableMetric(0, 0, (value) => String(value)), "missing");
});

test("Live merge preserves references only for complete unchanged list projections", () => {
  const base = {
    sessionId: "s1",
    project: "/tmp/project",
    lastEventAt: 1,
    lineCount: 2,
    pathBytes: 3,
    toolCalls: 4,
    toolErrors: 0,
    hookErrors: 0,
    model: "model-a",
    displayTitle: "old",
    dataQuality: 90,
    metricSources: { tokens: "measured" },
    traceGraph: { rootMessages: 1, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    modeSummary: { gitBranch: "main" },
  };
  const aggregate = (session: typeof base) => ({ sessions: [session] });
  const unchanged = mergeAggregate(aggregate(base) as never, aggregate({ ...base }) as never) as { sessions: typeof base[] };
  assert.equal(unchanged.sessions[0], base);

  for (const changed of [
    { ...base, hookErrors: 2 },
    { ...base, model: "model-b" },
    { ...base, displayTitle: "new" },
    { ...base, metricSources: { tokens: "missing" } },
  ]) {
    const merged = mergeAggregate(aggregate(base) as never, aggregate(changed) as never) as { sessions: typeof base[] };
    assert.notEqual(merged.sessions[0], base, "changed public fields must reach memoized rows");
    assert.deepEqual(merged.sessions[0], changed);
  }
});

test("drawer usage decimation preserves contiguous totals and endpoint snapshots", () => {
  const segments = Array.from({ length: 1_800 }, (_, index) => ({
    atMs: index,
    cumulativeInput: (index + 1) * 3,
    cumulativeOutput: (index + 1) * 2,
    deltaInput: 3,
    deltaOutput: 2,
    outTokPerSec: 2,
  }));
  const sampled = decimateUsageSegments(segments);
  assert.equal(sampled.length, DRAWER_USAGE_POINT_LIMIT);
  assert.equal(sampled.at(-1)?.cumulativeInput, segments.at(-1)?.cumulativeInput);
  assert.equal(sampled.at(-1)?.cumulativeOutput, segments.at(-1)?.cumulativeOutput);
  assert.equal(sampled.reduce((sum, segment) => sum + segment.deltaInput, 0), segments.reduce((sum, segment) => sum + segment.deltaInput, 0));
  assert.equal(sampled.reduce((sum, segment) => sum + segment.deltaOutput, 0), segments.reduce((sum, segment) => sum + segment.deltaOutput, 0));
  assert.equal(decimateUsageSegments(segments.slice(0, 2)).length, 2, "small traces are not rewritten");
});

test("Live shared formatters use human-scale number, duration, and currency output", () => {
  assert.equal(fmt(1_246_000), "1.2M");
  assert.equal(fmtMs(2_746_000), "45m 46s");
  assert.equal(fmtUsd(13_128.7825), "$13.1k");
});

test("historical inactivity and failed polling have distinct labels", () => {
  assert.equal(FILTER_MODES.find(([mode]) => mode === "stale")?.[1], "Inactive >12h");
  const primitives = fs.readFileSync(path.join(process.cwd(), "components/live/LivePrimitives.tsx"), "utf8");
  assert.match(primitives, /inactive &gt;12h/);
  assert.match(primitives, /Live updates failed · showing data from/);
  assert.match(primitives, /if \(session\.isError\)/);
  assert.doesNotMatch(primitives, /session\.isError \|\| session\.toolErrors/);
  assert.match(primitives, /tool incident/);
  assert.match(primitives, /hook incident/);
});

test("expanded Live windows reset on view changes, not polling array identity", () => {
  const table = fs.readFileSync(path.join(process.cwd(), "components/live/SessionTable.tsx"), "utf8");
  assert.match(table, /\[viewKey\]/);
  assert.doesNotMatch(table, /\[sessions\]/);
});

test("Live poll signature covers the exact public list projection", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/live/route.ts"), "utf8");
  assert.match(route, /serializeLiveProjection\(projected\)/);
  assert.match(route, /coalescedLiveScan\(limit, harness\)/);
  assert.match(route, /JSON\.stringify\(data\)/);
  assert.doesNotMatch(route, /old\.lastEventAt/);
});

test("Live drawer refreshes detail without hiding the last good evidence", () => {
  const drawer = fs.readFileSync(path.join(process.cwd(), "components/live/SessionDrawer.tsx"), "utf8");
  assert.match(drawer, /detailRefreshKey/);
  assert.match(drawer, /detailRefreshing/);
  assert.match(drawer, /Latest session detail refresh failed; showing the last complete detail/);
  assert.doesNotMatch(drawer, /setDetailSession\(null\)/);
  assert.match(drawer, /requestId !== detailRequestRef\.current/);
  assert.match(drawer, /return \(\) => \{ detailRequestRef\.current \+= 1; \}/);
  assert.match(drawer, /aria-labelledby="session-drawer-title"/);
  assert.match(drawer, /id="session-drawer-title"/);
  assert.match(drawer, /<StatusPill session=\{listSession\} \/>/);
  assert.match(drawer, /<IncidentBadges session=\{listSession\} \/>/);
  assert.match(drawer, /const UsageTimeline = React\.memo/);
});
