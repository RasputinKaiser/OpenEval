import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _setCacheDbForTest,
  claimJudgeJob,
  finishJudgeJob,
  heartbeatJudgeJob,
  interruptJudgeJob,
  loadJudgments,
  loadJudgeJob,
  saveJudgment,
  saveJudgeJob,
  updateJudgeJobProgress,
} from "../lib/live-cache";
import { judgeJobStatus, startJudgeAll } from "../lib/insights/judge";
import type { Marker, SessionPoint } from "../lib/insights/timeline";

async function withFileCache(fn: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judge-job-"));
  const dbPath = path.join(dir, "live-cache.db");
  const conn = new Database(dbPath);
  _setCacheDbForTest(conn);
  try {
    await fn(dbPath);
  } finally {
    conn.close();
    _setCacheDbForTest(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function stored(overrides: Partial<NonNullable<ReturnType<typeof loadJudgeJob>>> = {}) {
  return {
    state: "running" as const,
    total: 3,
    done: 0,
    judged: 0,
    failed: 0,
    judge: "test/judge",
    startedAt: 100,
    finishedAt: null,
    lastError: null,
    queue: ["/tmp/a.jsonl", "/tmp/b.jsonl", "/tmp/c.jsonl"],
    leaseId: "lease-a",
    ownerPid: 424242,
    heartbeatAt: 100,
    ...overrides,
  };
}

test("judge job lifecycle survives a cache connection/process-style reset", async () => {
  await withFileCache((dbPath) => {
    saveJudgeJob(stored());
    const first = loadJudgeJob();
    assert.equal(first?.total, 3);
    assert.deepEqual(first?.queue, ["/tmp/a.jsonl", "/tmp/b.jsonl", "/tmp/c.jsonl"]);

    // Simulate a process reset: close this SQLite handle and open the same
    // durable file through the test hook, with no in-memory job singleton.
    _setCacheDbForTest(null);
    const reopened = new Database(dbPath);
    _setCacheDbForTest(reopened);
    assert.deepEqual(loadJudgeJob(), first);
    reopened.close();
  });
});

test("stale running lease is reported interrupted instead of healthy", async () => {
  await withFileCache(() => {
    saveJudgeJob(stored({ heartbeatAt: Date.now() - 120_000, ownerPid: 424242 }));
    const status = judgeJobStatus();
    assert.equal(status.running, false);
    assert.match(status.lastError ?? "", /interrupted|lease/i);
    assert.equal(loadJudgeJob()?.state, "interrupted");
  });
});

test("heartbeat, progress, and finish are durable and lease-conditional", async () => {
  await withFileCache(() => {
    saveJudgeJob(stored({ heartbeatAt: Date.now(), ownerPid: process.pid }));
    assert.equal(heartbeatJudgeJob("lease-a"), true);
    assert.equal(updateJudgeJobProgress("lease-a", { ok: true }), true);
    assert.equal(updateJudgeJobProgress("lease-a", { ok: false, error: "backend timeout" }), true);
    const progressed = loadJudgeJob();
    assert.equal(progressed?.done, 2);
    assert.equal(progressed?.judged, 1);
    assert.equal(progressed?.failed, 1);
    assert.equal(progressed?.lastError, "backend timeout");
    assert.equal(finishJudgeJob("wrong-lease"), false);
    assert.equal(finishJudgeJob("lease-a"), true);
    assert.equal(loadJudgeJob()?.state, "finished");
    assert.equal(loadJudgeJob()?.leaseId, null);
  });
});

test("verdict writes are idempotent and retain only the latest bounded row", async () => {
  await withFileCache(() => {
    const file = "/tmp/phase2-idempotent.jsonl";
    saveJudgment({
      file,
      sessionId: "s1",
      mtimeMs: 1,
      score: 0.2,
      reasons: ["first"],
      judge: "test/judge",
      judgedAt: 1,
      promptVersion: 2,
    });
    saveJudgment({
      file,
      sessionId: "s1",
      mtimeMs: 2,
      score: 0.9,
      reasons: ["latest"],
      judge: "test/judge",
      judgedAt: 2,
      promptVersion: 2,
    });
    const rows = loadJudgments();
    assert.equal(rows.size, 1);
    assert.equal(rows.get(file)?.score, 0.9);
    assert.deepEqual(rows.get(file)?.reasons, ["latest"]);
  });
});

test("only one live lease claims the singleton; stale lease can be superseded", async () => {
  await withFileCache(() => {
    const live = stored({ heartbeatAt: Date.now() });
    saveJudgeJob(live);
    const contender = stored({ leaseId: "lease-b", ownerPid: process.pid, heartbeatAt: Date.now() });
    assert.equal(claimJudgeJob(contender), false, "a fresh running lease blocks a second job");
    assert.equal(claimJudgeJob(contender, { takeoverLeaseId: "lease-a" }), true);
    assert.equal(loadJudgeJob()?.leaseId, "lease-b");
  });
});

function point(at: number, file: string): SessionPoint {
  return {
    sessionId: `s-${at}`,
    at,
    source: "test",
    model: null,
    path: file,
    outcome: 0.5,
    outcomeHasSignal: false,
    outcomeProvenance: "heuristic",
    outcomeReasons: [],
    costUsd: 0,
    toolErrorRate: 0,
    toolCallsPerTurn: 0,
    subagentSpawns: 0,
    durationMin: 1,
    skills: ["durable-test"],
    mcpServers: [],
  };
}

test("startJudgeAll supersedes an interrupted row and persists progress/finish", async () => {
  await withFileCache(() => {
    const files = ["/tmp/phase2-missing-a.jsonl", "/tmp/phase2-missing-b.jsonl", "/tmp/phase2-missing-c.jsonl"];
    saveJudgeJob(stored({ queue: files, heartbeatAt: Date.now() - 120_000, ownerPid: 424242 }));
    const points = files.map((file, i) => point(i + 1, file));
    const markers: Marker[] = [{ kind: "skill", name: "durable-test", firstSeenAt: 2, sessionCount: 3 }];
    const started = startJudgeAll(points, markers, { timeoutMs: 100 });
    assert.equal(started.started, true);
    assert.equal(started.status.running, true);

    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const poll = () => {
        const status = judgeJobStatus();
        if (!status.running) {
          try {
            assert.equal(status.total, 3);
            assert.equal(status.done, 3);
            assert.equal(status.failed, 3);
            assert.equal(status.state, "finished");
            assert.match(status.lastError ?? "", /file no longer exists/);
            assert.equal(loadJudgeJob()?.state, "finished");
            resolve();
          } catch (error) { reject(error); }
          return;
        }
        if (Date.now() > deadline) { reject(new Error("judge job did not finish")); return; }
        setTimeout(poll, 10);
      };
      poll();
    });
  });
});

test("concurrent judge-all starts share one durable lease and do not duplicate a queue", async () => {
  await withFileCache(() => {
    const files = ["/tmp/phase2-duplicate-a.jsonl", "/tmp/phase2-duplicate-b.jsonl"];
    const points = files.map((file, i) => point(i + 1, file));
    const markers: Marker[] = [{ kind: "skill", name: "durable-test", firstSeenAt: 1, sessionCount: 3 }];
    const first = startJudgeAll(points, markers, { timeoutMs: 100 });
    const second = startJudgeAll(points, markers, { timeoutMs: 100 });
    assert.equal(first.started, true);
    assert.equal(second.started, false, "the second request must observe the first durable lease");
    assert.equal(second.status.state, "running");
    assert.equal(second.status.total, first.status.total);
    assert.equal(typeof second.status.heartbeatAt, "number");
    assert.ok((second.status.leaseExpiresAt ?? 0) > (second.status.heartbeatAt ?? 0));

    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const poll = () => {
        const status = judgeJobStatus();
        if (!status.running) {
          try {
            assert.equal(status.done, 2);
            assert.equal(status.failed, 2);
            resolve();
          } catch (error) { reject(error); }
          return;
        }
        if (Date.now() > deadline) { reject(new Error("duplicate-start job did not finish")); return; }
        setTimeout(poll, 10);
      };
      poll();
    });
  });
});

test("interrupted helper preserves queue for an explicit resume", async () => {
  await withFileCache(() => {
    saveJudgeJob(stored({ heartbeatAt: Date.now() }));
    assert.equal(interruptJudgeJob("lease-a", "process restarted"), true);
    const row = loadJudgeJob();
    assert.equal(row?.state, "interrupted");
    assert.deepEqual(row?.queue, ["/tmp/a.jsonl", "/tmp/b.jsonl", "/tmp/c.jsonl"]);
    assert.equal(row?.lastError, "process restarted");
  });
});

test("judge status API is uncached and exposes durable interruption details", async () => {
  await withFileCache(async () => {
    saveJudgeJob(stored({
      state: "interrupted",
      leaseId: null,
      ownerPid: null,
      heartbeatAt: null,
      lastError: "process restarted",
      finishedAt: 200,
    }));
    const route = await import("../app/api/collection/timeline/judge/route");
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
    const body = await response.json();
    assert.equal(body.state, "interrupted");
    assert.equal(body.running, false);
    assert.equal(body.lastError, "process restarted");
  });
});
