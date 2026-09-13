import test from "node:test";
import assert from "node:assert/strict";
import type { CollectedSession } from "../lib/collection/aggregate";
import { buildEvidenceSessionListPage, filterEvidenceSessionMetadata, toEvidenceSessionListItem } from "../lib/collection/evidence-session-list";

function session(overrides: Partial<CollectedSession> = {}): CollectedSession {
  return {
    sessionId: "session-1", sourceId: "codex", sourceLabel: "Codex", displayTitle: "Repair parser", lastPromptPreview: "Run tests", project: "/private/path", model: "gpt-5.6-luna", startedAt: 10, lastEventAt: 20, durationMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 2, costUsd: 0, usageSegments: [], toolCalls: 1, toolErrors: 0, numTurns: 1, stopReason: null, isError: false, pathBytes: 1, lineCount: 1, malformedLineCount: 0, thinkingBlocks: 0, textBlocks: 1, attachmentCount: 0, queueOperationCount: 0, snapshotCount: 0, hookErrors: 0, messageCount: 1, userType: null, dataQuality: 1, metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" }, parseWarnings: [], toolErrorRate: 0, toolCallsPerTurn: 1, textAvailability: 1, staleMs: 0, traceGraph: { rootMessages: 1, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 }, toolSummaries: [], toolDurations: [], queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] }, fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 }, modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null }, skillsUsed: [], mcpServersUsed: [], subagentSpawns: 0, cliVersion: null, outcomeSignals: { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 }, ...overrides,
  };
}

test("metadata search matches title, session ID, and model without exposing paths", () => {
  const rows = [session(), session({ sessionId: "model-session", displayTitle: "Other", model: "gpt-4.1", startedAt: 20 })];
  assert.equal(filterEvidenceSessionMetadata(rows, "parser").length, 1);
  assert.equal(filterEvidenceSessionMetadata(rows, "model-session").length, 1);
  assert.equal(filterEvidenceSessionMetadata(rows, "gpt-4.1").length, 1);
  const item = toEvidenceSessionListItem(rows[0]);
  assert.equal("path" in item, false);
  assert.equal(item.title, "Repair parser");
});

test("metadata list is deterministic, capped, and generation-bound", () => {
  const rows = [session({ sessionId: "old", startedAt: 10 }), session({ sessionId: "new", startedAt: 30 }), session({ sessionId: "mid", startedAt: 20 })];
  const page = buildEvidenceSessionListPage(rows, { generation: 42, query: "" }, { offset: 1, limit: 1 });
  assert.deepEqual(page.sessions.map((row) => row.sessionId), ["mid"]);
  assert.equal(page.totalMatched, 3);
  assert.equal(page.nextOffset, 2);
  assert.equal(page.generation, 42);
  const long = toEvidenceSessionListItem(session({ displayTitle: "x".repeat(500) }));
  assert.ok(long.title.length <= 160);
  assert.deepEqual(buildEvidenceSessionListPage(rows, { generation: 42 }, { offset: Number.NaN, limit: Number.POSITIVE_INFINITY }).sessions.map((row) => row.sessionId), ["new", "mid", "old"]);
});
