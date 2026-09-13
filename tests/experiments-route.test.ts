import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-experiments-route-"));
process.env.OPENEVAL_DATA_ROOT = root;
let route: typeof import("../app/api/experiments/route");
let dbmod: typeof import("../lib/db");

test.before(async () => {
  dbmod = await import("../lib/db");
  route = await import("../app/api/experiments/route");
  const summary = { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0, passRate: 1, totalCostUsd: 0, totalTokensIn: 1, totalTokensOut: 1, totalDurationMs: 1, byCategory: {} };
  for (const id of ["route-a", "route-b"]) {
    dbmod.insertRun({ id, name: id, status: "completed", created_at: 1, ended_at: 2, params: { runner: "headless", parallel: 1 }, summary });
    dbmod.insertRunCase({ id: `${id}-case`, run_id: id, case_id: "route-case", case_name: "Route case", category: "reasoning", status: "passed", started_at: 1, ended_at: 2, workdir_path: "/tmp/fixture", transcript_path: null, runner_kind: "headless", runner_result: null, grader_result: null, evaluation: null, budget_exceeded: false, error_msg: null, case_def: { id: "route-case", name: "Route case", category: "reasoning", prompt: "fixture", graders: [] }, seq: 0, sample: 0 } as any);
  }
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("experiment route validates JSON and persists/reopens saved IDs", async () => {
  const malformed = await route.POST(new Request("http://localhost/api/experiments", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  const created = await route.POST(new Request("http://localhost/api/experiments", { method: "POST", body: JSON.stringify({ hypothesis: "Route fixture hypothesis", baselineRunId: "route-a", candidateRunId: "route-b", cohort: [{ caseId: "route-case", sample: 0 }] }) }));
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const id = createdBody.experiment.experimentId;
  const list = await route.GET(new Request("http://localhost/api/experiments?limit=1"));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).experiments[0].experimentId, id);
  const direct = await route.GET(new Request(`http://localhost/api/experiments?id=${encodeURIComponent(id)}`));
  assert.equal(direct.status, 200);
  assert.equal((await direct.json()).experiment.baseline.cases[0].caseId, "route-case");
  const missing = await route.GET(new Request("http://localhost/api/experiments?id=outside-latest-50"));
  assert.equal(missing.status, 404);
});

test("experiment route rejects an unfinished source run", async () => {
  const db = dbmod.getDb();
  dbmod.insertRun({ id: "route-running", name: "running", status: "running", created_at: 1, ended_at: null, params: { runner: "headless", parallel: 1 }, summary: null });
  const response = await route.POST(new Request("http://localhost/api/experiments", { method: "POST", body: JSON.stringify({ hypothesis: "invalid", baselineRunId: "route-running", candidateRunId: "route-b", cohort: [{ caseId: "route-case", sample: 0 }] }) }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).detail, /completed/);
  assert.equal(db.prepare("SELECT COUNT(*) FROM experiments").pluck().get(), 1);
});
