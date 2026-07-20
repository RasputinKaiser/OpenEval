import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAggregate, LiveSession } from "../lib/live";
import {
  applyLiveViewState,
  collectionTranscriptHref,
  isSessionStale,
  mergeAggregate,
  needsAttention,
  parseLiveViewState,
  selectVisibleSessions,
  sessionKey,
  shortId,
  staleThresholdMs,
} from "../components/live/live-shared";

function makeSession(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    sessionId: "session-1",
    displayTitle: null,
    lastPromptPreview: null,
    project: "proj",
    model: "test-model",
    startedAt: 1000,
    lastEventAt: 2000,
    durationMs: 1000,
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
    pathBytes: 10,
    lineCount: 1,
    malformedLineCount: 0,
    thinkingBlocks: 0,
    textBlocks: 0,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount: 1,
    userType: null,
    dataQuality: 90,
    metricSources: {
      model: "measured",
      tokens: "measured",
      cost: "measured",
      duration: "measured",
      turns: "measured",
    },
    parseWarnings: [],
    toolErrorRate: 0,
    toolCallsPerTurn: 0,
    textAvailability: 1,
    staleMs: 0,
    traceGraph: { rootMessages: 1, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [],
    toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion: null,
    outcomeSignals: { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 },
    ...overrides,
  };
}

function makeAggregate(sessions: LiveSession[]): LiveAggregate {
  return { sessions, totalSessions: sessions.length } as unknown as LiveAggregate;
}

test("sessionKey prefers transcript path and falls back to id+project", () => {
  assert.equal(sessionKey(makeSession({ path: "/tmp/a.jsonl" })), "/tmp/a.jsonl");
  const a = makeSession({ sessionId: "s1", project: "p1", path: undefined });
  const b = makeSession({ sessionId: "s1", project: "p2", path: undefined });
  assert.notEqual(sessionKey(a), sessionKey(b));
  assert.equal(sessionKey(a), "s1\u0000p1");
});

test("mergeAggregate keeps object identity for unchanged sessions", () => {
  const unchanged = makeSession({ path: "/t/one.jsonl" });
  const changedOld = makeSession({ path: "/t/two.jsonl", lineCount: 5 });
  const prev = makeAggregate([unchanged, changedOld]);
  const changedNew = { ...changedOld, lineCount: 6 };
  const next = makeAggregate([{ ...unchanged }, changedNew]);

  const merged = mergeAggregate(prev, next);
  assert.notEqual(merged, prev, "wrapper must come from next");
  assert.equal(merged.sessions[0], unchanged, "unchanged session keeps previous reference");
  assert.equal(merged.sessions[1], changedNew, "changed session takes the new reference");
});

test("mergeAggregate returns next verbatim when prev is null or empty", () => {
  const next = makeAggregate([makeSession()]);
  assert.equal(mergeAggregate(null, next), next);
  assert.equal(mergeAggregate(makeAggregate([]), next), next);
});

test("mergeAggregate treats archived flip as a change", () => {
  const old = makeSession({ path: "/t/one.jsonl", archived: undefined });
  const archived = { ...old, archived: true };
  const merged = mergeAggregate(makeAggregate([old]), makeAggregate([archived]));
  assert.equal(merged.sessions[0], archived);
});

test("parseLiveViewState reads params and rejects unknown values", () => {
  const parsed = parseLiveViewState(new URLSearchParams("filter=attention&sort=errors&q=fix"));
  assert.deepEqual(parsed, { filter: "attention", sort: "errors", search: "fix" });
  const junk = parseLiveViewState(new URLSearchParams("filter=nope&sort=bogus"));
  assert.deepEqual(junk, { filter: "all", sort: "recent", search: "" });
  assert.deepEqual(parseLiveViewState(new URLSearchParams()), { filter: "all", sort: "recent", search: "" });
});

test("applyLiveViewState omits defaults and round-trips non-defaults", () => {
  const params = new URLSearchParams("harness=codex&filter=stale&q=old");
  applyLiveViewState(params, { filter: "all", sort: "recent", search: "" });
  assert.equal(params.toString(), "harness=codex", "defaults are removed, unrelated params survive");

  const shared = new URLSearchParams("harness=ncode");
  applyLiveViewState(shared, { filter: "missing", sort: "quality", search: " needle " });
  assert.deepEqual(parseLiveViewState(shared), { filter: "missing", sort: "quality", search: "needle" });
  assert.equal(shared.get("harness"), "ncode");
});

test("selectVisibleSessions filters by attention, staleness, and missing provenance", () => {
  const now = Date.now();
  const healthy = makeSession({ sessionId: "healthy", path: "/t/h.jsonl", lastEventAt: now });
  const erroring = makeSession({ sessionId: "erroring", path: "/t/e.jsonl", toolErrors: 3, lastEventAt: now });
  const stale = makeSession({ sessionId: "stale", path: "/t/s.jsonl", lastEventAt: now - staleThresholdMs() - 1000 });
  const missing = makeSession({
    sessionId: "missing",
    path: "/t/m.jsonl",
    lastEventAt: now,
    metricSources: { ...makeSession().metricSources, tokens: "missing" },
  });
  const all = [healthy, erroring, stale, missing];

  assert.deepEqual(selectVisibleSessions(all, { filter: "all", sort: "recent", search: "" }, now).length, 4);
  assert.deepEqual(
    selectVisibleSessions(all, { filter: "attention", sort: "recent", search: "" }, now).map((s) => s.sessionId),
    ["erroring"]
  );
  assert.deepEqual(
    selectVisibleSessions(all, { filter: "stale", sort: "recent", search: "" }, now).map((s) => s.sessionId),
    ["stale"]
  );
  assert.deepEqual(
    selectVisibleSessions(all, { filter: "missing", sort: "recent", search: "" }, now).map((s) => s.sessionId),
    ["missing"]
  );
});

test("selectVisibleSessions searches id, project, title, and model", () => {
  const now = Date.now();
  const byTitle = makeSession({ sessionId: "a", path: "/t/a.jsonl", displayTitle: "Fix flaky test", lastEventAt: now });
  const byModel = makeSession({ sessionId: "b", path: "/t/b.jsonl", model: "opus-mini", lastEventAt: now });
  const rows = [byTitle, byModel];
  assert.deepEqual(selectVisibleSessions(rows, { filter: "all", sort: "recent", search: "FLAKY" }, now).map((s) => s.sessionId), ["a"]);
  assert.deepEqual(selectVisibleSessions(rows, { filter: "all", sort: "recent", search: "opus" }, now).map((s) => s.sessionId), ["b"]);
  assert.deepEqual(selectVisibleSessions(rows, { filter: "all", sort: "recent", search: "zzz" }, now), []);
});

test("selectVisibleSessions sort modes order correctly and do not mutate input", () => {
  const now = Date.now();
  const lowQuality = makeSession({ sessionId: "lowq", path: "/1", dataQuality: 40, lastEventAt: now - 3000 });
  const errors = makeSession({ sessionId: "errs", path: "/2", toolErrors: 9, dataQuality: 95, lastEventAt: now - 2000 });
  const fresh = makeSession({ sessionId: "fresh", path: "/3", dataQuality: 99, lastEventAt: now });
  const input = [lowQuality, errors, fresh];
  const snapshot = [...input];

  assert.deepEqual(selectVisibleSessions(input, { filter: "all", sort: "recent", search: "" }, now).map((s) => s.sessionId), ["fresh", "errs", "lowq"]);
  assert.deepEqual(selectVisibleSessions(input, { filter: "all", sort: "quality", search: "" }, now).map((s) => s.sessionId), ["lowq", "errs", "fresh"]);
  assert.deepEqual(selectVisibleSessions(input, { filter: "all", sort: "errors", search: "" }, now).map((s) => s.sessionId), ["errs", "fresh", "lowq"]);
  assert.deepEqual(input, snapshot, "input array must not be reordered");
});

test("staleness derives from lastEventAt against the injected clock", () => {
  const now = 10_000_000_000;
  assert.equal(isSessionStale(makeSession({ lastEventAt: now - staleThresholdMs() + 60_000 }), now), false);
  assert.equal(isSessionStale(makeSession({ lastEventAt: now - staleThresholdMs() - 60_000 }), now), true);
});

test("needsAttention triggers on errors, hook errors, low quality, malformed lines", () => {
  assert.equal(needsAttention(makeSession()), false);
  assert.equal(needsAttention(makeSession({ isError: true })), true);
  assert.equal(needsAttention(makeSession({ toolErrors: 1 })), true);
  assert.equal(needsAttention(makeSession({ hookErrors: 1 })), true);
  assert.equal(needsAttention(makeSession({ dataQuality: 69 })), true);
  assert.equal(needsAttention(makeSession({ malformedLineCount: 2 })), true);
});

test("collectionTranscriptHref links only when a transcript path exists", () => {
  assert.equal(collectionTranscriptHref(makeSession({ path: undefined })), null);
  assert.equal(
    collectionTranscriptHref(makeSession({ path: "/x/y z.jsonl" })),
    `/collection/session?file=${encodeURIComponent("/x/y z.jsonl")}`
  );
});

test("shortId truncates long ids only", () => {
  assert.equal(shortId("short-id"), "short-id");
  const long = "abcdefgh-1234-5678-9012-abcdefghijkl";
  assert.equal(shortId(long), "abcdefgh...hijkl");
});
