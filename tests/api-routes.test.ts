import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RunCaseRecord, RunRecord } from "../lib/types";
import { execFileSync } from "node:child_process";

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
  const reportRoute = await import("../app/api/runs/[id]/report/route");
  const runDetailRoute = await import("../app/api/runs/[id]/route");
  const db = await import("../lib/db");
  return { runsRoute, cancelRoute, artifactRoute, reportRoute, runDetailRoute, db };
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

test("POST /api/runs: malformed request shapes are rejected before selection", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  const res = await runsRoute.POST(postRuns([]));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /JSON object/);
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: parallel and samples reject fractional or out-of-range values instead of clamping", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  for (const [field, value] of [["parallel", 2.5], ["samples", 9], ["samples", "1e3"]] as const) {
    const res = await runsRoute.POST(postRuns({ [field]: value, caseIds: ["does-not-exist"] }));
    assert.equal(res.status, 400, `${field}=${value} should be rejected`);
    const body = await res.json();
    assert.equal(body.field, field);
    assert.match(body.error, new RegExp(`${field} must be an integer between 1 and 8`));
  }
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: unknown runner and non-array caseIds are field-tagged errors", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  const runner = await runsRoute.POST(postRuns({ runner: "bogus", caseIds: ["does-not-exist"] }));
  assert.equal(runner.status, 400);
  assert.equal((await runner.json()).field, "runner");
  const caseIds = await runsRoute.POST(postRuns({ caseIds: "does-not-exist" }));
  assert.equal(caseIds.status, 400);
  assert.equal((await caseIds.json()).field, "caseIds");
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: malformed filter arrays are rejected instead of becoming an unfiltered launch", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  for (const [field, value] of [["categories", "reasoning"], ["tags", ["visual", 7]], ["difficulty", [" "]]] as const) {
    const res = await runsRoute.POST(postRuns({ [field]: value }));
    assert.equal(res.status, 400, `${field} must not be silently ignored`);
    const body = await res.json();
    assert.equal(body.field, field);
    assert.match(body.error, /array of strings|only strings|blank values/);
  }
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: nonexistent case id fails case selection with 400 before any harness starts", async () => {
  const { runsRoute, db } = await importRoutes();
  const before = db.countRuns();
  const res = await runsRoute.POST(postRuns({ runner: "headless", parallel: 1, samples: 1, caseIds: ["does-not-exist"] }));
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

test("GET /api/runs/[id]?lite=1 strips heavy runner and grader payloads", async () => {
  const { runDetailRoute, db } = await importRoutes();
  const run = makeRun({ id: "liteload", status: "completed", ended_at: Date.now() });
  db.insertRun(run);
  db.insertRunCase(makeRunCase(run.id, 1, {
    runner_result: {
      exitCode: 0,
      durationMs: 5,
      startedAt: Date.now() - 10,
      endedAt: Date.now(),
      transcript: [{ role: "assistant", content: [{ type: "text", text: "AUTHORITATIVE_TRANSCRIPT_BODY_" + "x".repeat(10000) }] }],
      toolCalls: [{ name: "tool", input: "x".repeat(500), output: "y".repeat(500), at: Date.now() }],
      finalText: "z".repeat(700),
      resultText: "ok",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
      numTurns: 1,
      stopReason: "end",
      sessionId: "session",
      model: "test",
      isError: false,
      rawJson: { secret: "heavy" },
      tokenSegments: [],
      toolCallCounts: { tool: 1 },
    } as unknown as RunCaseRecord["runner_result"],
    grader_result: {
      passed: true,
      score: 1,
      results: [{ graderId: "g", passed: true, score: 1, output: "heavy grader output" }],
    } as unknown as RunCaseRecord["grader_result"],
  }));

  const res = await runDetailRoute.GET(
    new Request(`http://localhost:3000/api/runs/${run.id}?lite=1`),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  const body = await res.json();
  const row = body.cases[0];
  assert.equal(row.runner_result.rawJson, null);
  assert.deepEqual(row.runner_result.transcript, [], "lite/list projections omit transcript bodies");
  assert.equal(row.runner_result.transcriptAvailable, false);
  assert.equal(row.runner_result.finalText.length, 500);
  assert.equal(row.runner_result.toolCalls[0].input.length, 200);
  assert.equal(row.runner_result.toolCalls[0].output.length, 200);
  assert.equal(row.grader_result.results[0].output, undefined);
});

test("GET /api/runs/[id]/report?bundle=1 returns a portable redacted archive", async () => {
  const { reportRoute, db } = await importRoutes();
  const runId = "bundlerun";
  db.insertRun(makeRun({ id: runId, name: "Bundle me", status: "completed", ended_at: Date.now(), manifest: { harness: { id: "test" } } }));
  const res = await reportRoute.GET(
    new Request(`http://localhost:3000/api/runs/${runId}/report?bundle=1&redact=1`),
    { params: Promise.resolve({ id: runId }) },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/gzip");
  assert.match(res.headers.get("content-disposition") ?? "", /openeval-run-bundlerun\.tar\.gz/);
  const archive = path.join(os.tmpdir(), `openeval-api-${randomUUID()}.tar.gz`);
  try {
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
    assert.match(listing, /openeval-run-bundlerun\/report\.md/);
    assert.match(listing, /openeval-run-bundlerun\/manifest\.json/);
    assert.match(listing, /openeval-run-bundlerun\/summary\.json/);
  } finally {
    fs.rmSync(archive, { force: true });
  }
});

test("GET /api/runs/[id]/report streams the Markdown download from a bounded file body", async () => {
  const { reportRoute, db } = await importRoutes();
  const runId = "stream-report";
  db.insertRun(makeRun({ id: runId, name: "Stream me", status: "completed", ended_at: Date.now() }));
  const res = await reportRoute.GET(
    new Request(`http://localhost:3000/api/runs/${runId}/report`),
    { params: Promise.resolve({ id: runId }) },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.ok(Number(res.headers.get("content-length")) > 0);
  assert.ok(res.body, "report delivery should expose a stream body");
  assert.match(await res.text(), /^# Stream me \(stream-report\)/);
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
  const artifact = await ok.json();
  assert.equal(artifact.content, "safe result");
  assert.equal(artifact.bytes, Buffer.byteLength("safe result"));
  assert.equal(artifact.sha256, "59aa1e19bf892c8a2106ac56a3e0cf7e969b3bc037cd5ce821b177caa7c0f4b1");
  assert.equal(typeof artifact.modifiedAtMs, "number");
  assert.match(ok.headers.get("etag") ?? "", /^"[a-f0-9]{64}"$/);
  const notModified = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=result.txt`, {
      headers: { "if-none-match": ok.headers.get("etag") ?? "" },
    }),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(notModified.status, 304);
  const escaped = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=../outside.txt`),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(escaped.status, 400);
});

test("GET artifact bounds JSON previews and supports safe byte ranges", async () => {
  const { artifactRoute, db } = await importRoutes();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  const workdir = path.join(tempRoot, "workdir-bounded-artifact");
  const artifactPath = path.join(workdir, "large.txt");
  const previewLimit = 512 * 1024;
  const content = `artifact-start\n${"x".repeat(previewLimit + 128)}`;
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(artifactPath, content, "utf8");
  db.insertRun(run);
  db.insertRunCase(makeRunCase(run.id, 1, { workdir_path: workdir }));

  const previewResponse = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=large.txt`),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.bytes, Buffer.byteLength(content));
  assert.equal(preview.contentTruncated, true);
  assert.ok(Buffer.byteLength(preview.content, "utf8") <= previewLimit);
  assert.equal(preview.content, content.slice(0, preview.content.length));

  const rangeResponse = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=large.txt`, {
      headers: { range: "bytes=7-16" },
    }),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get("accept-ranges"), "bytes");
  assert.equal(rangeResponse.headers.get("content-range"), `bytes 7-16/${Buffer.byteLength(content)}`);
  assert.equal(Buffer.from(await rangeResponse.arrayBuffer()).toString("utf8"), content.slice(7, 17));

  const invalidRange = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=large.txt`, {
      headers: { range: "bytes=not-a-range" },
    }),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get("content-range"), `bytes */${Buffer.byteLength(content)}`);
});

test("GET artifact rejects symlinks that escape the case workdir", async () => {
  const { artifactRoute, db } = await importRoutes();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  const workdir = path.join(tempRoot, "workdir-symlink");
  const outside = path.join(tempRoot, "outside-secret.txt");
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(outside, "must not be served");
  fs.symlinkSync(outside, path.join(workdir, "escaped.txt"));
  db.insertRun(run);
  db.insertRunCase(makeRunCase(run.id, 1, { workdir_path: workdir }));

  const escaped = await artifactRoute.GET(
    new NextRequest(`http://localhost:3000/api/runs/${run.id}/case/case-1/artifact?path=escaped.txt`),
    { params: Promise.resolve({ id: run.id, caseId: "case-1" }) },
  );

  assert.equal(escaped.status, 400);
  assert.match((await escaped.json()).error, /invalid path/i);
});
