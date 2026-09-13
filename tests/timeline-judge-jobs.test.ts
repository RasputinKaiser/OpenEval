import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _setCacheDbForTest, loadJudgeReceipts, loadLatestJudgeReceipts } from "../lib/live-cache";
import { judgePoints } from "../lib/insights/judge";
import { makeJudgeSelection } from "../lib/grader/selection";
import type { SessionPoint } from "../lib/insights/timeline";

function point(file: string): SessionPoint {
  return {
    sessionId: "job-session",
    sourceId: "codex",
    at: 1,
    source: "Codex",
    model: "gpt-5.6-luna",
    path: file,
    outcome: 0.5,
    outcomeHasSignal: false,
    outcomeProvenance: "unavailable",
    outcomeReasons: [],
    costUsd: 0,
    toolErrorRate: 0,
    toolCallsPerTurn: 0,
    subagentSpawns: 0,
    durationMin: 1,
    skills: ["review"],
    mcpServers: [],
  };
}

test("deterministic transport produces an evidence-bound historical receipt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judge-job-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Run the tests" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "c1", name: "npm test", arguments: "{}" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "Exit code: 0\n4 passed" } }),
  ].join("\n") + "\n");
  const db = new Database(":memory:");
  _setCacheDbForTest(db);
  try {
    const result = await judgePoints([point(file)], [{ kind: "skill", name: "review", firstSeenAt: 1, sessionCount: 3 }], {
      selection: makeJudgeSelection({ source: "stub", model: "deterministic-v1", resolution: "job" }),
      timeoutMs: 100,
    });
    assert.equal(result.judged, 1);
    assert.equal(result.failed, 0);
    const receipts = loadJudgeReceipts(file);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].evidenceVersion, "evidence-packet.v1");
    assert.equal(receipts[0].promptVersion, 4);
    assert.equal(receipts[0].outcome, "insufficient_evidence");
    assert.equal(loadLatestJudgeReceipts().get(file)?.receiptId, receipts[0].receiptId);
  } finally {
    db.close();
    _setCacheDbForTest(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
