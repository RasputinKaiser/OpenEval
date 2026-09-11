import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunCaseRecord, RunRecord } from "../lib/types";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-leaderboard-analysis-"));
process.env.OPENEVAL_DATA_ROOT = path.join(tempRoot, "state");

let db: typeof import("../lib/db");
let route: typeof import("../app/api/harnesses/leaderboard/route");

function makeRun(id: string, createdAt: number, harness: string, model: string): RunRecord {
  return {
    id,
    name: `${harness} ${id}`,
    status: "completed",
    created_at: createdAt,
    ended_at: createdAt + 10,
    params: { runner: "headless", harness, parallel: 1, model, samples: 2 },
    summary: null,
  };
}

function makeCase(
  runId: string,
  id: string,
  category: RunCaseRecord["category"],
  sample: number,
  status: RunCaseRecord["status"],
  runner?: { costUsd?: number; costSource?: "measured" | "inferred"; durationMs?: number; model?: string },
): RunCaseRecord & { seq: number } {
  return {
    id: `${runId}-${id}-${sample}`,
    run_id: runId,
    case_id: id,
    case_name: id,
    category,
    status,
    started_at: 1_700_000_000_000,
    ended_at: 1_700_000_001_000,
    workdir_path: "/tmp/leaderboard-fixture",
    transcript_path: null,
    raw_output: null,
    runner_kind: "headless",
    runner_result: runner ? {
      exitCode: status === "error" ? 1 : 0,
      durationMs: runner.durationMs,
      startedAt: 1_700_000_000_000,
      endedAt: runner.durationMs === undefined ? null : 1_700_000_000_000 + runner.durationMs,
      transcript: [],
      toolCalls: [],
      finalText: "",
      resultText: "",
      usage: {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        costUsd: runner.costUsd,
        costSource: runner.costSource,
      },
      numTurns: 1,
      stopReason: "end_turn",
      sessionId: id,
      model: runner.model ?? null,
      isError: status === "error",
      rawJson: null,
      tokenSegments: [],
      toolCallCounts: {},
    } as any : null,
    grader_result: null,
    evaluation: null,
    budget_exceeded: false,
    error_msg: null,
    case_def: { id, name: id, category, prompt: "fixture", graders: [] },
    seq: sample + 1,
    sample,
    harness_info: undefined,
  };
}

test("leaderboard preserves workload identity and metric provenance within latest-run scope", async () => {
  db = await import("../lib/db");
  route = await import("../app/api/harnesses/leaderboard/route");

  db.insertRun(makeRun("claude-new", 300, "claude-code", "gpt-5.6"));
  db.insertRunCase(makeCase("claude-new", "case-alpha", "reasoning", 0, "passed", { costUsd: 0, costSource: "measured", durationMs: 0, model: "gpt-5.6" }));
  db.insertRunCase(makeCase("claude-new", "case-beta", "agentic-swe", 1, "failed", { costUsd: 1.25, costSource: "inferred", durationMs: 1_500, model: "gpt-5.6" }));

  db.insertRun(makeRun("claude-old", 200, "claude-code", "gpt-5.6"));
  db.insertRunCase(makeCase("claude-old", "case-alpha", "reasoning", 0, "passed"));

  db.insertRun(makeRun("codex-one", 100, "codex", "gpt-5.5"));
  db.insertRunCase(makeCase("codex-one", "case-visual", "visual-code", 0, "passed", { costUsd: 0.5, durationMs: 2_500, model: "gpt-5.5" }));

  const summaries = db.getRunCaseSummariesBatch(["claude-new"]);
  const summary = summaries.get("claude-new") ?? [];
  assert.equal(summary[0]?.case_id, "case-alpha");
  assert.equal(summary[0]?.category, "reasoning");
  assert.equal(summary[0]?.sample, 0);
  assert.equal(summary[0]?.runner_cost_source, "measured");
  assert.equal(summary[0]?.runner_duration_source, "measured");

  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json() as { harnesses: any[]; scope: any };
  assert.equal(body.scope.latestRuns, 3);
  assert.equal(body.scope.totalRuns, 3);
  assert.equal(body.scope.truncated, false);

  const claude = body.harnesses.find((row) => row.harness === "claude-code");
  assert.ok(claude);
  assert.equal(claude.totalCases, 3);
  assert.equal(claude.passed, 2);
  assert.equal(claude.passRate, 2 / 3);
  assert.equal(claude.workload.uniqueCaseIds, 2);
  assert.deepEqual(claude.workload.samples, [0, 1]);
  assert.deepEqual(claude.workload.caseIds.map((item: any) => item.caseId), ["case-alpha", "case-beta"]);
  assert.deepEqual(claude.workload.categories.map((item: any) => item.category), ["reasoning", "agentic-swe"]);
  assert.equal(claude.workload.models[0]?.model, "gpt-5.6");
  assert.equal(claude.workload.runReferences.length, 2);
  assert.equal(claude.workload.mixed, true);

  assert.equal(claude.costCoverage.total, 3);
  assert.equal(claude.costCoverage.available, 2);
  assert.equal(claude.costCoverage.missing, 1);
  assert.equal(claude.costCoverage.measured, 1);
  assert.equal(claude.costCoverage.inferred, 1);
  assert.equal(claude.costCoverage.zero, 1);
  assert.equal(claude.durationCoverage.total, 3);
  assert.equal(claude.durationCoverage.available, 2);
  assert.equal(claude.durationCoverage.missing, 1);
  assert.equal(claude.durationCoverage.zero, 1);
  assert.equal(claude.totalCostUsd, 1.25);
  assert.equal(claude.totalDurationMs, 1_500);

  const codex = body.harnesses.find((row) => row.harness === "codex");
  assert.equal(codex.workload.caseIds[0].caseId, "case-visual");
  assert.equal(codex.costCoverage.unspecified, 1);
  assert.equal(codex.costCoverage.available, 1);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
