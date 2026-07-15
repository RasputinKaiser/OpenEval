import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RunCaseRecord, RunRecord } from "../lib/types";

// lib/config captures ROOT from process.cwd() at import time, so every
// cwd-rooted path (data/eval.db, cases/, workdirs/) must be redirected into a
// temp dir BEFORE any route module — and through it lib/db — is imported.
// Route imports below are dynamic for that reason.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-api-routes-"));
process.chdir(tempRoot);

after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function importRoutes() {
  const runsRoute = await import("../app/api/runs/route");
  const cancelRoute = await import("../app/api/runs/[id]/cancel/route");
  const artifactRoute = await import("../app/api/runs/[id]/case/[caseId]/artifact/route");
  const db = await import("../lib/db");
  return { runsRoute, cancelRoute, artifactRoute, db };
}

function postRuns(body: unknown): Request {
  return new Request("http://localhost:3000/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: randomUUID().slice(0, 8),
    name: "test run",
    status: "running",
    created_at: Date.now(),
    ended_at: null,
    params: { runner: "headless", parallel: 1 },
    summary: null,
    ...over,
  };
}

function makeRunCase(runId: string, seq: number, over: Partial<RunCaseRecord> = {}): RunCaseRecord & { seq: number } {
  return {
    id: randomUUID(),
    run_id: runId,
    case_id: `case-${seq}`,
    case_name: `Case ${seq}`,
    category: "agentic-swe",
    status: "passed",
    started_at: Date.now() - 1000,
    ended_at: Date.now(),
    workdir_path: "",
    transcript_path: null,
    runner_kind: "headless",
    runner_result: null,
    grader_result: null,
    evaluation: null,
    budget_exceeded: false,
    error_msg: null,
    case_def: { id: `case-${seq}`, name: `Case ${seq}`, category: "agentic-swe", prompt: "noop", graders: [] } as unknown as RunCaseRecord["case_def"],
    seq,
    sample: 0,
    ...over,
  };
}

test("POST /api/runs: explicit-but-empty caseIds is a 400, no run created", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  const res = await runsRoute.POST(postRuns({ caseIds: [] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /caseIds/);
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: whitespace-only caseIds entries collapse to empty → 400", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  const res = await runsRoute.POST(postRuns({ caseIds: ["  ", ""] }));
  assert.equal(res.status, 400);
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: nonexistent case id fails case selection with 400 before any harness starts", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  // Bad runner kind and absurd parallel/samples are normalized (coerced/clamped),
  // not rejected — so the only observable guard on this path is case selection,
  // which fails here because the temp cwd has no cases/ dir.
  const res = await runsRoute.POST(postRuns({ runner: "bogus", parallel: 9999, samples: -5, caseIds: ["does-not-exist"] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /No cases match/);
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: malformed JSON body degrades to empty filter → 400 (no cases in temp root)", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  const res = await runsRoute.POST(postRuns("{not json"));
  assert.equal(res.status, 400);
  assert.equal(db.countRuns(), before);
});

test("GET /api/runs: list shape includes id, name, status", async () => {
  const { runsRoute, db } = await importRoutes();
  db.insertRun(makeRun({ id: "listrun1", name: "List me", status: "completed", ended_at: Date.now() }));
  const res = await runsRoute.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.runs));
  const row = body.runs.find((r: { id: string }) => r.id === "listrun1");
  assert.ok(row, "inserted run appears in the list");
  assert.deepEqual(Object.keys(row).sort(), ["id", "name", "status"]);
  assert.equal(row.status, "completed");
});

test("POST /api/runs/[id]/cancel: nonexistent run → 404", async () => {
  const { cancelRoute } = await importRoutes();
  const res = await cancelRoute.POST(
    new Request("http://localhost:3000/api/runs/nope/cancel", { method: "POST" }),
    { params: Promise.resolve({ id: "nope" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error, /not found/i);
});

test("POST /api/runs/[id]/cancel: non-running run → 409", async () => {
  const { cancelRoute, db } = await importRoutes();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  db.insertRun(run);
  const res = await cancelRoute.POST(
    new Request(`http://localhost:3000/api/runs/${run.id}/cancel`, { method: "POST" }),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /completed/);
  assert.equal(db.getRun(run.id)?.status, "completed");
});

test("POST /api/runs/[id]/cancel: running run → aborted with interim summary", async () => {
  const { cancelRoute, db } = await importRoutes();
  const run = makeRun({ status: "running" });
  db.insertRun(run);
  db.insertRunCase(makeRunCase(run.id, 1, { status: "passed" }));
  db.insertRunCase(makeRunCase(run.id, 2, { status: "failed" }));
  // Still in flight when the cancel lands — the interim summary must count it
  // (as stranded) rather than lose it.
  db.insertRunCase(makeRunCase(run.id, 3, { status: "running", ended_at: null }));

  const res = await cancelRoute.POST(
    new Request(`http://localhost:3000/api/runs/${run.id}/cancel`, { method: "POST" }),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.run.id, run.id);
  assert.equal(body.run.status, "aborted");
  assert.ok(body.run.summary, "interim summary present");
  assert.equal(body.run.summary.total, 3);
  assert.equal(body.run.summary.passed, 1);
  assert.equal(body.run.summary.failed, 1);
  assert.equal(body.run.summary.stranded, 1);
  assert.equal(db.getRun(run.id)?.status, "aborted");
});

test("GET artifact refuses cases without an absolute workdir", async () => {
  const { artifactRoute, db } = await importRoutes();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  db.insertRun(run);
  db.insertRunCase(makeRunCase(run.id, 1, { workdir_path: "" }));
  const res = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=package.json`),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /workdir/i);
});

test("GET artifact serves files only from the case workdir", async () => {
  const { artifactRoute, db } = await importRoutes();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  const workdir = path.join(tempRoot, "workdir-safe");
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, "result.txt"), "safe result");
  db.insertRun(run);
  db.insertRunCase(makeRunCase(run.id, 1, { workdir_path: workdir }));
  const ok = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=result.txt`),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).content, "safe result");
  const escaped = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=../outside.txt`),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(escaped.status, 400);
});
