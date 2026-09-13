import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  _setCacheDbForTest,
  loadJudgeReceipts,
  loadJudgments,
  loadLegacyJudgeHistory,
  saveEvidenceJudgment,
  saveJudgeJob,
  saveJudgment,
  type StoredJudgeReceipt,
  type StoredJudgment,
} from "../lib/live-cache";

const file = "/tmp/persistence-hardening.jsonl";

function receipt(id: string, score: number | null = null): StoredJudgeReceipt {
  return {
    receiptId: id,
    file,
    sourceId: "codex",
    sessionId: "session-1",
    revision: `revision-${id}`,
    evidenceDigest: `digest-${id}`,
    evidenceVersion: "evidence-packet.v1",
    promptVersion: 4,
    outcome: score == null ? "insufficient_evidence" : "partial",
    score,
    confidence: score == null ? "low" : "medium",
    reasons: score == null ? ["evidence incomplete"] : ["observed result"],
    evidenceIds: score == null ? [] : [`evidence-${id}`],
    contradictionEvidenceIds: [],
    judge: "stub/deterministic-v1",
    createdAt: Number(id.replace(/\D/g, "")) || 1,
  };
}

function legacyProjection(): StoredJudgment {
  return {
    file,
    sessionId: "session-1",
    mtimeMs: 12,
    score: 0.8,
    reasons: ["legacy score"],
    judge: "legacy-judge",
    judgedAt: 99,
  };
}

function currentProjection(id: string, score = 0.6): StoredJudgment {
  return {
    file,
    sessionId: "session-1",
    mtimeMs: 13,
    score,
    reasons: ["current score"],
    judge: "stub/deterministic-v1",
    judgedAt: Number(id.replace(/\D/g, "")) || 2,
    promptVersion: 4,
    evidenceDigest: `digest-${id}`,
    evidenceVersion: "evidence-packet.v1",
    revision: `revision-${id}`,
    sourceId: "codex",
    verdictStatus: "partial",
    confidence: "medium",
    evidenceIds: [`evidence-${id}`],
    contradictionEvidenceIds: [],
  };
}

function withDb(run: (db: Database.Database) => void): void {
  const db = new Database(":memory:");
  _setCacheDbForTest(db);
  try { run(db); } finally { db.close(); _setCacheDbForTest(null); }
}

test("atomic null verdict clears the old score and retains the receipt plus legacy history", () => {
  withDb(() => {
    const old = legacyProjection();
    assert.equal(saveJudgment(old), true);
    assert.equal(saveEvidenceJudgment(receipt("r1"), null), true);
    assert.equal(loadJudgments().has(file), false);
    assert.equal(loadJudgeReceipts(file).length, 1);
    const history = loadLegacyJudgeHistory(file);
    assert.equal(history.length, 1);
    assert.equal(history[0].score, old.score);
    assert.equal(history[0].promptVersion, undefined);
    assert.equal(history[0].evidenceIds, undefined);
  });
});

test("superseded legacy projections are archived once without inventing v4 fields", () => {
  withDb(() => {
    assert.equal(saveJudgment(legacyProjection()), true);
    assert.equal(saveEvidenceJudgment(receipt("r2", 0.5), currentProjection("r2", 0.5)), true);
    assert.equal(saveEvidenceJudgment(receipt("r3", 0.7), currentProjection("r3", 0.7)), true);
    const history = loadLegacyJudgeHistory(file);
    assert.equal(history.length, 1);
    assert.equal(history[0].judge, "legacy-judge");
    assert.equal(history[0].verdictStatus, undefined);
    assert.equal(history[0].evidenceDigest, undefined);
    assert.equal(loadJudgeReceipts(file).length, 2);
  });
});

test("receipt or projection failure rolls back the complete evidence write", () => {
  withDb((db) => {
    const old = legacyProjection();
    assert.equal(saveJudgment(old), true);
    db.exec("DROP TABLE judge_receipts");
    assert.equal(saveEvidenceJudgment(receipt("r4"), null), false);
    assert.equal(loadJudgeReceipts(file).length, 0);
    _setCacheDbForTest(db);
    assert.equal(loadJudgments().get(file)?.score, old.score);
    assert.equal(loadLegacyJudgeHistory(file).length, 0);
  });
});

test("lease fencing prevents receipt, archive, and projection writes", () => {
  withDb(() => {
    const old = legacyProjection();
    assert.equal(saveJudgment(old), true);
    saveJudgeJob({
      state: "running", total: 1, done: 0, judged: 0, failed: 0, judge: "stub",
      startedAt: Date.now(), finishedAt: null, lastError: null, queue: [file], leaseId: "owner", ownerPid: 1, heartbeatAt: Date.now(),
    });
    assert.equal(saveEvidenceJudgment(receipt("r5"), null, { leaseId: "superseded" }), false);
    assert.equal(loadJudgeReceipts(file).length, 0);
    assert.equal(loadJudgments().get(file)?.score, old.score);
    assert.equal(loadLegacyJudgeHistory(file).length, 0);
  });
});

test("real legacy prompt versions are preserved and ignored writes roll back", () => {
  withDb((db) => {
    const old = { ...legacyProjection(), promptVersion: 2 };
    assert.equal(saveJudgment(old), true);
    db.exec("CREATE TRIGGER ignore_projection BEFORE INSERT ON outcome_judgments BEGIN SELECT RAISE(IGNORE); END");
    assert.equal(saveEvidenceJudgment(receipt("r6", 0.6), currentProjection("r6", 0.6)), false);
    assert.equal(loadJudgeReceipts(file).length, 0);
    assert.equal(loadLegacyJudgeHistory(file).length, 0);
    assert.equal(loadJudgments().get(file)?.score, old.score);
    db.exec("DROP TRIGGER ignore_projection");
    assert.equal(saveEvidenceJudgment(receipt("r7"), null), true);
    assert.equal(loadLegacyJudgeHistory(file)[0].promptVersion, 2);
    assert.equal(loadJudgments().has(file), false);
  });
});

test("a mismatched receipt and numeric projection cannot be saved", () => {
  withDb(() => {
    assert.equal(saveEvidenceJudgment(receipt("r8", 0.6), currentProjection("r8", 0.7)), false);
    assert.equal(loadJudgeReceipts(file).length, 0);
    assert.equal(loadJudgments().size, 0);
  });
});
