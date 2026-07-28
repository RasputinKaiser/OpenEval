import test from "node:test";
import assert from "node:assert/strict";
import { shouldPollJudgeStatus, timelinePollError, timelineRefreshPhase } from "../lib/timeline-poll-state";

test("timeline refresh phase exposes loading, error, stale, and fresh states", () => {
  assert.equal(timelineRefreshPhase({ hasData: false, loading: true }), "loading");
  assert.equal(timelineRefreshPhase({ hasData: true, loading: false, error: "offline" }), "error");
  assert.equal(timelineRefreshPhase({ hasData: true, loading: false, stale: true }), "stale");
  assert.equal(timelineRefreshPhase({ hasData: true, loading: false }), "fresh");
  assert.equal(timelineRefreshPhase({ hasData: false, loading: false }), "error");
});

test("judge polling continues only for a running job", () => {
  assert.equal(shouldPollJudgeStatus({ running: true }), true);
  assert.equal(shouldPollJudgeStatus({ running: false }), false);
  assert.equal(shouldPollJudgeStatus(null), false);
  assert.equal(shouldPollJudgeStatus(undefined), false);
});

test("poll errors retain useful messages without throwing", () => {
  assert.equal(timelinePollError(new Error("network down")), "network down");
  assert.equal(timelinePollError("HTTP 503"), "HTTP 503");
});
