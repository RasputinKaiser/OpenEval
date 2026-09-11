import test from "node:test";
import assert from "node:assert/strict";
import { previewJudgeQueue } from "../lib/insights/judge-queue";
import type { SessionPoint } from "../lib/insights/timeline";

function point(overrides: Partial<SessionPoint> = {}): SessionPoint {
  return {
    sessionId: overrides.sessionId ?? "s",
    sourceId: overrides.sourceId ?? "codex",
    at: overrides.at ?? 1,
    source: overrides.source ?? "Codex",
    model: overrides.model ?? "gpt-5.6-luna",
    path: overrides.path ?? "/tmp/session.jsonl",
    outcome: overrides.outcome ?? 0.5,
    outcomeHasSignal: overrides.outcomeHasSignal ?? false,
    outcomeProvenance: overrides.outcomeProvenance ?? "unavailable",
    outcomeReasons: overrides.outcomeReasons ?? [],
    costUsd: 0,
    toolErrorRate: 0,
    toolCallsPerTurn: 0,
    subagentSpawns: 0,
    durationMin: 1,
    skills: [],
    mcpServers: [],
  };
}

test("review preview exposes bounded gaps and applies date/source/model filters", () => {
  const preview = previewJudgeQueue({
    points: [
      point({ sessionId: "a", path: "/tmp/a", at: 10, sourceId: "codex", source: "Codex" }),
      point({ sessionId: "b", path: "/tmp/b", at: 20, sourceId: "claude", source: "Claude", model: "sonnet" }),
      point({ sessionId: "c", path: "/tmp/c", at: 30, sourceId: "codex", source: "Codex" }),
    ],
  }, { from: 15, to: 35, source: "Codex", model: "gpt-5.6-luna", limit: 1 });
  assert.equal(preview.total, 1);
  assert.equal(preview.items[0].reasons.includes("gap"), true);
  assert.equal(preview.truncated, false);
  assert.deepEqual(preview.counts, { gap: 1, uncertain: 0, disagreement: 0, changed: 0, balanced: 0 });
  assert.equal(preview.execution.concurrency, 1);
  assert.equal(preview.packetBounds.maxRecords, 256);
});

test("changed and disagreement receipts are explicit queue reasons", () => {
  const p = point({ path: "/tmp/current", outcome: 0.9, heuristicOutcome: 0.9, heuristicOutcomeHasSignal: true, outcomeHasSignal: true, outcomeProvenance: "heuristic" });
  const preview = previewJudgeQueue({
    points: [p],
    judgments: new Map([[p.path!, {
      file: p.path!, sessionId: p.sessionId, mtimeMs: 1, score: 0.1, reasons: [], judge: "old", judgedAt: 1,
      promptVersion: 3,
    }]]),
    evidence: new Map([[p.path!, { sufficiency: "sufficient", contentDigest: "new", revision: "new" }]]),
    receipts: new Map([[p.path!, {
      receiptId: "r", file: p.path!, sourceId: "codex", sessionId: p.sessionId, revision: "old", evidenceDigest: "old",
      evidenceVersion: "evidence-packet.v1", promptVersion: 3, outcome: "achieved", status: "achieved", score: 0.1, confidence: "medium",
      reasons: [], evidenceIds: [], contradictionEvidenceIds: [], judge: "old", createdAt: 1,
    }]]),
  }, { limit: 10 });
  assert.deepEqual(preview.items[0].reasons.sort(), ["changed", "disagreement"]);
});

test("review method and source/session identity changes are explicit", async () => {
  const { makeJudgeSelection } = await import("../lib/grader/selection");
  const selected = makeJudgeSelection({ source: "codex", model: "gpt-5.6-luna", reasoningEffort: "high", resolution: "job" });
  const other = makeJudgeSelection({ source: "codex", model: "gpt-5.6-luna", reasoningEffort: "low", resolution: "job" });
  const p = point();
  const receipt = { receiptId: "method", file: p.path!, sourceId: p.sourceId!, sessionId: p.sessionId, revision: "v", evidenceDigest: "digest", evidenceVersion: "evidence-packet.v1", promptVersion: 4, outcome: "achieved" as const, score: 1, confidence: "medium" as const, reasons: [], evidenceIds: [], contradictionEvidenceIds: [], judge: other.judgeName, selection: other, createdAt: 1 };
  assert.deepEqual(previewJudgeQueue({ points: [p], selection: selected, receipts: new Map([[p.path!, receipt]]) }).items[0].reasons, ["changed"]);
  assert.deepEqual(previewJudgeQueue({ points: [p], selection: other, receipts: new Map([[p.path!, receipt]]) }).items[0].reasons, ["balanced"]);
  assert.deepEqual(previewJudgeQueue({ points: [p], receipts: new Map([[p.path!, { ...receipt, sessionId: "reused-path" }]]) }).items[0].reasons, ["changed"]);
  assert.equal(previewJudgeQueue({ points: [p] }, { to: p.at }).returned, 0, "upper date bound is exclusive");
});
