import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CaseDefinition, RunCaseRecord, RunRecord } from "../lib/types";

/**
 * Run lifecycle: orphan sweeping and cancel semantics through lib/run's public
 * exports. createAndStartRun is NOT driven here: its loop always passes a
 * resolved harness into executeCase, which triggers discoverHarnesses and
 * --version probes of every registered CLI (claude/codex on a dev machine) —
 * not hermetic. The loop's cancellation DB check is covered at its seam: the
 * run row's status is the source of truth, written/read via lib/db.
 *
 * eval.db lands in a mkdtemp root: OPENEVAL_DATA_ROOT + chdir happen BEFORE
 * the lib modules are (dynamically) imported.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-run-lifecycle-"));
process.env.OPENEVAL_DATA_ROOT = path.join(tmpRoot, "state");
process.chdir(tmpRoot);

test.after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const STALE_AGE_MS = 11 * 60 * 1000; // past the sweep's 10-minute threshold

function runRecord(id: string, status: RunRecord["status"], createdAt: number): RunRecord {
  return {
    id,
    name: `run ${id}`,
    status,
    created_at: createdAt,
    ended_at: null,
    params: { runner: "headless", parallel: 1 },
    summary: null,
  };
}

function caseRecord(runId: string, seq: number, status: RunCaseRecord["status"]): RunCaseRecord & { seq: number } {
  const caseId = `case-${seq}`;
  return {
    id: randomUUID(),
    run_id: runId,
    case_id: caseId,
    case_name: caseId,
    category: "single-tool",
    status,
    started_at: Date.now(),
    ended_at: null,
    workdir_path: "",
    transcript_path: null,
    runner_kind: "headless",
    runner_result: null,
    grader_result: null,
    evaluation: null,
    budget_exceeded: false,
    error_msg: null,
    case_def: { id: caseId, name: caseId, category: "single-tool", prompt: "p", graders: [{ type: "manual" }] } as CaseDefinition,
    seq,
    sample: 0,
  };
}

test("requestRunCancel returns false for a run this process is not looping on", async () => {
  const { requestRunCancel } = await import("../lib/run");
  assert.equal(requestRunCancel("no-such-run"), false);
});

test("sweepOrphanRuns aborts a stale running run and errors its non-terminal cases", async () => {
  const { sweepOrphanRuns } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "stale-run";
  db.insertRun(runRecord(runId, "running", Date.now() - STALE_AGE_MS));
  db.insertRunCase(caseRecord(runId, 1, "running"));
  db.insertRunCase(caseRecord(runId, 2, "grading"));
  db.insertRunCase(caseRecord(runId, 3, "passed"));

  assert.equal(sweepOrphanRuns(), 1);

  const run = db.getRun(runId);
  assert.equal(run?.status, "aborted");
  assert.ok(run?.ended_at, "sweep stamps ended_at");
  assert.equal(run?.summary?.errored, 2);
  assert.equal(run?.summary?.passed, 1);
  assert.equal(run?.summary?.stranded, 0, "swept cases are terminal before the summary");

  const cases = db.listRunCases(runId);
  assert.deepEqual(cases.map((c) => c.status), ["error", "error", "passed"]);
  for (const c of cases.slice(0, 2)) assert.equal(c.error_msg, "orphaned");

  const kinds = db.listEvents(runId).map((e) => e.kind);
  assert.ok(kinds.includes("run_aborted"));

  assert.equal(sweepOrphanRuns(), 0, "an aborted run is not swept twice");
});

test("sweepOrphanRuns leaves recently created running runs alone", async () => {
  const { sweepOrphanRuns } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "fresh-run";
  db.insertRun(runRecord(runId, "running", Date.now()));
  assert.equal(sweepOrphanRuns(), 0);
  assert.equal(db.getRun(runId)?.status, "running");
  db.updateRunStatus(runId, "aborted", Date.now(), null); // keep later sweeps clean
});

test("sweepOrphanRuns treats recent event activity as liveness", async () => {
  const { sweepOrphanRuns } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "active-run";
  db.insertRun(runRecord(runId, "running", Date.now() - STALE_AGE_MS));
  db.appendEvent(runId, "case_started", { case_id: "case-1" }, "case-1");
  assert.equal(sweepOrphanRuns(), 0);
  assert.equal(db.getRun(runId)?.status, "running");
  db.updateRunStatus(runId, "aborted", Date.now(), null);
});

test("sweepOrphanRuns never touches runs already in a terminal status", async () => {
  const { sweepOrphanRuns } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "completed-run";
  db.insertRun(runRecord(runId, "completed", Date.now() - STALE_AGE_MS));
  db.insertRunCase(caseRecord(runId, 1, "grading"));
  assert.equal(sweepOrphanRuns(), 0);
  assert.equal(db.getRun(runId)?.status, "completed");
  assert.equal(db.listRunCases(runId)[0]?.status, "grading");
});

test("cancel seam: an aborted run row is visible through the DB check the loop uses", async () => {
  const db = await import("../lib/db");
  const runId = "cancel-run";
  db.insertRun(runRecord(runId, "running", Date.now()));
  assert.equal(db.getRun(runId)?.status, "running");
  // The cancel route writes the DB row first; runLoopBody's isCancelled()
  // re-reads it between cases (registry state can be lost to HMR).
  db.updateRunStatus(runId, "aborted", Date.now(), null);
  assert.equal(db.getRun(runId)?.status, "aborted");
});

// --- run.ts hardening: fire-and-forget manifest + fatal-catch resilience ---

test("writeRunManifestIfLive writes the manifest while the run is still running", async () => {
  const { writeRunManifestIfLive } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "manifest-live-run";
  db.insertRun(runRecord(runId, "running", Date.now()));
  writeRunManifestIfLive(runId, { probed: true });
  assert.deepEqual(db.getRun(runId)?.manifest, { probed: true });
  db.updateRunStatus(runId, "aborted", Date.now(), null);
});

test("writeRunManifestIfLive no-ops once the run row is terminal (late manifest can't clobber)", async () => {
  const { writeRunManifestIfLive } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "manifest-late-run";
  // Run already finished/aborted while collectRunManifest was still probing.
  db.insertRun(runRecord(runId, "completed", Date.now()));
  writeRunManifestIfLive(runId, { late: true });
  assert.equal(db.getRun(runId)?.manifest, undefined, "a late manifest write must not land on a terminal run");
});

// Regression: the top-level runLoop(...).catch invokes updateRunStatus, which
// can itself throw (DB error). Before the fix that throw escaped the .catch of
// a fire-and-forget promise as an unhandled rejection. finalizeFailedRun must
// contain it. We induce a real DB error by renaming the `runs` table aside
// (updateRunStatus then fails to prepare) while the events table stays intact,
// and always restore it.
test("finalizeFailedRun contains a throwing updateRunStatus and still records run_fatal", async () => {
  const { finalizeFailedRun } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "fatal-sync-run";
  db.insertRun(runRecord(runId, "running", Date.now()));
  const raw = db.getDb();

  let threw = false;
  raw.exec("ALTER TABLE runs RENAME TO runs_bak_fatal_sync");
  try {
    finalizeFailedRun(runId, new Error("loop blew up"));
  } catch {
    threw = true; // without the try/catch around updateRunStatus this is reached
  } finally {
    raw.exec("ALTER TABLE runs_bak_fatal_sync RENAME TO runs");
  }

  assert.equal(threw, false, "finalizeFailedRun must swallow a throwing updateRunStatus");
  const kinds = db.listEvents(runId).map((e) => e.kind);
  assert.ok(kinds.includes("run_fatal"), "run_fatal event is recorded even when the status write fails");
  db.updateRunStatus(runId, "failed", Date.now(), null);
});

test("a rejected runLoop whose status write throws produces no unhandled rejection", async () => {
  const { finalizeFailedRun } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "fatal-async-run";
  db.insertRun(runRecord(runId, "running", Date.now()));
  const raw = db.getDb();

  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onUnhandled);
  raw.exec("ALTER TABLE runs RENAME TO runs_bak_fatal_async");
  try {
    // Exact production shape: a fire-and-forget promise whose .catch runs the
    // finalizer, which internally hits a throwing updateRunStatus.
    void Promise.reject(new Error("loop blew up")).catch((e) => finalizeFailedRun(runId, e));
    await new Promise((r) => setTimeout(r, 25));
  } finally {
    raw.exec("ALTER TABLE runs_bak_fatal_async RENAME TO runs");
    process.removeListener("unhandledRejection", onUnhandled);
  }

  assert.deepEqual(seen, [], "no unhandled rejection escaped the fatal-run finalizer");
  db.updateRunStatus(runId, "failed", Date.now(), null);
});
