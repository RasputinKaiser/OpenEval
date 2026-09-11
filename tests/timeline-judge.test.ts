import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidencePacket } from "../lib/insights/evidence";
import { judgmentMatchesSession, toPoints } from "../lib/insights/timeline";
import type { LiveSession, OutcomeSignals } from "../lib/live";
import type { StoredJudgment } from "../lib/live-cache";

function session(file: string): LiveSession & { sourceLabel: string; sourceId: string } {
  const outcomeSignals: OutcomeSignals = { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 };
  return {
    sessionId: "fresh-session", displayTitle: null, lastPromptPreview: null, project: "/p", model: "m",
    startedAt: 1, lastEventAt: 1, durationMs: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0,
    totalTokens: 0, costUsd: 0, usageSegments: [], toolCalls: 1, toolErrors: 0, numTurns: 1, stopReason: null, isError: false,
    pathBytes: fs.statSync(file).size, lineCount: fs.readFileSync(file, "utf8").split("\n").length - 1, malformedLineCount: 0,
    thinkingBlocks: 0, textBlocks: 1, attachmentCount: 0, queueOperationCount: 0, snapshotCount: 0, hookErrors: 0, messageCount: 1,
    userType: null, dataQuality: 1, metricSources: { model: "measured", tokens: "measured", cost: "inferred", duration: "measured", turns: "measured" },
    parseWarnings: [], toolErrorRate: 0, toolCallsPerTurn: 1, textAvailability: 1, staleMs: 0,
    traceGraph: { rootMessages: 1, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 }, toolSummaries: [], toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] }, fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null }, skillsUsed: [], mcpServersUsed: [], subagentSpawns: 0, cliVersion: null,
    outcomeSignals, path: file, sourceLabel: "Codex", sourceId: "codex",
  };
}

test("v4 receipt eligibility is bound to digest and revision", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judge-fresh-"));
  const file = path.join(dir, "session.jsonl");
  try {
    fs.writeFileSync(file, JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Run tests" } }) + "\n");
    const current = session(file);
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: current.sessionId, maxRecords: 256, maxBytes: 4 * 1024 * 1024, excerptChars: 600, maxEpisodes: 16 });
    const stat = fs.statSync(file);
    const judgment: StoredJudgment = {
      file, sessionId: current.sessionId, mtimeMs: stat.mtimeMs, score: 0.8, reasons: [], judge: "stub", judgedAt: 1,
      promptVersion: 4, evidenceDigest: packet.contentDigest, evidenceVersion: "evidence-packet.v1",
      revision: `${stat.mtimeMs}:${stat.size}:${current.pathBytes}:${current.lineCount}`, sourceId: "codex", verdictStatus: "achieved",
    };
    assert.equal(judgmentMatchesSession(current, judgment), true);
    fs.writeFileSync(file, JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Different request" } }) + "\n");
    assert.equal(judgmentMatchesSession(current, judgment), false);
    assert.equal(toPoints([current], new Map([[file, judgment]]))[0].outcomeProvenance, "unavailable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reused paths cannot transfer a prior session verdict", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judge-identity-"));
  const file = path.join(dir, "session.jsonl");
  try {
    fs.writeFileSync(file, "{}\n");
    const current = session(file);
    const stat = fs.statSync(file);
    const receipt: StoredJudgment = { file, sessionId: current.sessionId, sourceId: current.sourceId, mtimeMs: stat.mtimeMs, revision: `${stat.mtimeMs}:${stat.size}:${current.pathBytes}:${current.lineCount}:${stat.ctimeMs}`, score: 1, reasons: [], judge: "fixture", judgedAt: 1, promptVersion: 4 };
    assert.equal(judgmentMatchesSession(current, receipt, { verifyDigest: false }), true);
    assert.equal(judgmentMatchesSession({ ...current, sessionId: "different-session" }, receipt, { verifyDigest: false }), false);
    assert.equal(judgmentMatchesSession(current, { ...receipt, sourceId: "another-source" }, { verifyDigest: false }), false);
    assert.equal(judgmentMatchesSession(current, { ...receipt, revision: receipt.revision!.split(":").slice(0, 4).join(":") + ":0" }, { verifyDigest: false }), false, "ctime fences metadata-preserving source rewrites");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
