import test from "node:test";
import assert from "node:assert/strict";
import { loadDashboardObservation } from "../lib/dashboard-observation";
import type { AllSourcesResult, CollectedSession } from "../lib/collection/aggregate";
import type { TimelineReport } from "../lib/insights/collect";

const EMPTY_COLLECTION = {
  generatedAtMs: 1,
  sources: [],
  unknown: [],
  sessions: [],
  presentSources: 0,
  totalFiles: 0,
  totalParsedSessions: 0,
  totalArchivedSessions: 0,
  totalCostUsd: 0,
  anyEstimatedCost: false,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheCreateTokens: 0,
  totalToolCalls: 0,
  totalPricedSessions: 0,
  totalMeasuredCostSessions: 0,
  totalListedRateSessions: 0,
  totalFamilyRateSessions: 0,
  totalFallbackRateSessions: 0,
  pricingListDate: "",
  pricingSource: "",
  byModel: [],
  byTool: [],
} satisfies AllSourcesResult;

const EMPTY_TIMELINE = {
  totalSessions: 0,
  signalSessions: 0,
  judgedSessions: 0,
  heuristicSignalSessions: 0,
  noSignalSessions: 0,
  signalCoverage: 0,
  judgedCoverage: 0,
  dateStart: null,
  dateEnd: null,
  overall: { firstHalfOutcome: 0, secondHalfOutcome: 0, trend: 0 },
  markers: [],
  impacts: [],
  changePoints: [],
  outcomeSeries: [],
} satisfies TimelineReport;

test("dashboard observation keeps a collection failure distinct from an empty collection", () => {
  const result = loadDashboardObservation({
    scanCollection: () => { throw new Error("collection DB unavailable"); },
    collectSessions: () => [],
    buildTimeline: () => EMPTY_TIMELINE,
  });

  assert.equal(result.collection, null);
  assert.equal(result.collectionError, "collection DB unavailable");
  assert.equal(result.timeline, EMPTY_TIMELINE);
  assert.equal(result.timelineError, null);
});

test("dashboard observation keeps timeline failure visible without hiding collection data", () => {
  const sessions: CollectedSession[] = [];
  const result = loadDashboardObservation({
    scanCollection: () => EMPTY_COLLECTION,
    collectSessions: () => sessions,
    buildTimeline: (received) => {
      assert.equal(received, sessions);
      throw new Error("judgment cache corrupt");
    },
  });

  assert.equal(result.collection, EMPTY_COLLECTION);
  assert.equal(result.collectionError, null);
  assert.equal(result.timeline, null);
  assert.equal(result.timelineError, "judgment cache corrupt");
});

test("dashboard observation returns explicit success states for a genuinely empty corpus", () => {
  const result = loadDashboardObservation({
    scanCollection: () => EMPTY_COLLECTION,
    collectSessions: () => [],
    buildTimeline: () => EMPTY_TIMELINE,
  });

  assert.equal(result.collection?.totalFiles, 0);
  assert.equal(result.timeline?.totalSessions, 0);
  assert.equal(result.collectionError, null);
  assert.equal(result.timelineError, null);
});

test("dashboard observation redacts paths and secrets before rendering failures", () => {
  const result = loadDashboardObservation({
    scanCollection: () => {
      throw new Error("/Users/private-name/.agent failed with sk-abcdefghijklmnopqrstuvwxyz123456");
    },
    collectSessions: () => [],
    buildTimeline: () => EMPTY_TIMELINE,
  });

  assert.doesNotMatch(result.collectionError ?? "", /private-name|sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(result.collectionError ?? "", /\[redacted\]|\[REDACTED:/);
});
