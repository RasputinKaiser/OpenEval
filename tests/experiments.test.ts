import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-experiments-"));
process.env.OPENEVAL_DATA_ROOT = root;

let dbmod: typeof import("../lib/db");
let experiments: typeof import("../lib/experiments");
let db: ReturnType<typeof import("../lib/db").getDb>;

test.before(async () => {
  dbmod = await import("../lib/db");
  experiments = await import("../lib/experiments");
  db = dbmod.getDb();
});

function summary() {
  return { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0, passRate: 1, totalCostUsd: 0, totalTokensIn: 10, totalTokensOut: 12, totalDurationMs: 100, byCategory: {} };
}
function seedRun(id: string, status: "completed" | "running" = "completed", pairs: Array<{ caseId: string; sample?: number }> = [{ caseId: "case-a" }, { caseId: "case-b" }]) {
  dbmod.insertRun({ id, name: `Run ${id}`, status, created_at: 10, ended_at: status === "completed" ? 20 : null, params: { runner: "headless", parallel: 1, harness: "fixture", model: `model-${id}`, judge: { source: "fixture", model: "judge-model", reasoningEffort: null, resolution: "case", readiness: "ready", judgeName: "fixture/judge-model" } }, summary: status === "completed" ? summary() : null });
  pairs.forEach((pair, index) => dbmod.insertRunCase({
    id: `${id}-record-${index}`, run_id: id, case_id: pair.caseId, case_name: pair.caseId, category: "reasoning", status: "passed", started_at: 1, ended_at: 2,
    workdir_path: "/tmp/fixture", transcript_path: null, runner_kind: "headless", runner_result: { model: `model-${id}`, durationMs: 100, numTurns: 1, stopReason: "end", isError: false, usage: { inputTokens: 10, outputTokens: 12, costUsd: 0, costSource: "missing" } },
    grader_result: { passed: true, passRatio: 1, durationMs: 2, results: [{ spec: { type: "exit_code" }, passed: true, detail: "ok", durationMs: 1, score: 1 }] }, evaluation: null, budget_exceeded: false, error_msg: null,
    case_def: { id: pair.caseId, name: pair.caseId, category: "reasoning", prompt: "fixture", graders: [] }, seq: index, sample: pair.sample ?? 0,
  } as any));
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("experiments freeze exact shared cohorts and method provenance", () => {
  seedRun("baseline");
  seedRun("candidate");
  const saved = experiments.createExperiment({ hypothesis: "Candidate preserves the shared fixture outcomes.", baselineRunId: "baseline", candidateRunId: "candidate" }, db);
  assert.equal(saved.cohort.length, 2);
  assert.equal(saved.baseline.configuration.model, "model-baseline");
  assert.equal(saved.candidate.judge && (saved.candidate.judge as { model: string }).model, "judge-model");
  assert.equal(saved.baseline.cases[0]?.runner.costUsd, null, "missing cost source must remain unavailable");
  assert.equal(saved.baseline.cases[0]?.grading.methods[0]?.type, "exit_code");
  assert.equal(experiments.listExperiments(50, db)[0]?.experimentId, saved.experimentId);
  assert.equal(experiments.getExperiment(saved.experimentId, db)?.sourceStates.baseline.status, "available");
});

test("experiments reject unfinished, duplicate, missing, and empty cohorts", () => {
  seedRun("running-run", "running");
  assert.throws(() => experiments.createExperiment({ hypothesis: "x", baselineRunId: "running-run", candidateRunId: "candidate", cohort: [{ caseId: "case-a", sample: 0 }] }, db), /completed/);
  assert.throws(() => experiments.createExperiment({ hypothesis: "x", baselineRunId: "candidate", candidateRunId: "candidate", cohort: [{ caseId: "case-a", sample: 0 }] }, db), /differ/);
  assert.throws(() => experiments.createExperiment({ hypothesis: "x", baselineRunId: "baseline", candidateRunId: "candidate", cohort: [{ caseId: "missing", sample: 0 }] }, db), /missing/);
  assert.throws(() => experiments.createExperiment({ hypothesis: "x", baselineRunId: "baseline", candidateRunId: "candidate", cohort: [] }, db), /1 to/);
  assert.throws(() => experiments.createExperiment({ hypothesis: "x", baselineRunId: "baseline", candidateRunId: "candidate", cohort: [{ caseId: "case-a", sample: 0 }, { caseId: "case-a", sample: 0 }] }, db), /duplicate/);
});

test("loaded experiments identify changed and unavailable sources without changing snapshots", () => {
  seedRun("historical-a");
  seedRun("historical-b");
  const saved = experiments.createExperiment({ hypothesis: "Historical fixture", baselineRunId: "historical-a", candidateRunId: "historical-b", cohort: [{ caseId: "case-a", sample: 0 }] }, db);
  db.prepare("UPDATE runs SET name = ? WHERE id = ?").run("Changed name", "historical-a");
  const changed = experiments.getExperiment(saved.experimentId, db);
  assert.equal(changed?.sourceStates.baseline.status, "changed");
  assert.equal(changed?.baseline.name, "Run historical-a");
  db.prepare("DELETE FROM runs WHERE id = ?").run("historical-a");
  const unavailable = experiments.getExperiment(saved.experimentId, db);
  assert.equal(unavailable?.sourceStates.baseline.status, "unavailable");
  assert.equal(unavailable?.baseline.cases.length, 1);
});
