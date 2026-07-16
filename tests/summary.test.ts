import test from "node:test";
import assert from "node:assert/strict";
import { computeSummary, computeTelemetry } from "../lib/summary";
import { passAtK, mean } from "../lib/stats";
import type { CaseDefinition, RunCaseRecord, RunnerResult } from "../lib/types";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

function runnerResult(overrides: Partial<RunnerResult> = {}): RunnerResult {
  return {
    exitCode: 0,
    durationMs: 1000,
    startedAt: 0,
    endedAt: 1000,
    transcript: [],
    toolCalls: [],
    finalText: "done",
    resultText: "done",
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.01 },
    numTurns: 2,
    stopReason: null,
    sessionId: null,
    model: null,
    isError: false,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
    ...overrides,
  };
}

function rc(
  caseId: string,
  status: RunCaseRecord["status"],
  opts: { sample?: number; category?: string; runner?: RunnerResult | null } = {}
): RunCaseRecord {
  return {
    id: `${caseId}-s${opts.sample ?? 0}`,
    run_id: "r1",
    case_id: caseId,
    case_name: caseId,
    category: (opts.category ?? "single-tool") as RunCaseRecord["category"],
    status,
    started_at: 0,
    ended_at: 1,
    workdir_path: "",
    transcript_path: null,
    runner_kind: "headless",
    runner_result: opts.runner ?? null,
    grader_result: null,
    evaluation: null,
    budget_exceeded: false,
    error_msg: null,
    case_def: { id: caseId, name: caseId, category: "single-tool", prompt: "p", graders: [{ type: "manual" }] } as CaseDefinition,
    sample: opts.sample ?? 0,
  };
}

// ---- computeSummary: stranded counting ----

test("computeSummary counts non-terminal statuses as stranded, outside every outcome bucket", () => {
  const cases = [
    rc("a", "passed"),
    rc("b", "failed"),
    rc("c", "error"),
    rc("d", "skipped"),
    rc("e", "running"),
    rc("f", "grading"),
    rc("g", "pending"),
  ];
  const s = computeSummary(cases);
  assert.equal(s.total, 7);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.errored, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.stranded, 3);
  assert.equal(s.passed + s.failed + s.errored + s.skipped + (s.stranded ?? 0), s.total);
  assert.ok(close(s.passRate, 1 / 7));
  // Stranded cases still appear in the per-category totals, just no outcome.
  assert.equal(s.byCategory["single-tool"].total, 7);
  assert.equal(s.byCategory["single-tool"].passed + s.byCategory["single-tool"].failed + s.byCategory["single-tool"].errored, 3);
});

test("computeSummary of an all-terminal run has zero stranded", () => {
  const s = computeSummary([rc("a", "passed"), rc("b", "failed")]);
  assert.equal(s.stranded, 0);
  assert.equal(s.missingCostCases, 2);
});

test("computeSummary exposes how many case costs are inferred", () => {
  const inferred = runnerResult({ usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.01, costSource: "inferred" } });
  const measured = runnerResult({ usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.02, costSource: "measured" } });
  const missing = runnerResult({ usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 9, costSource: "missing" } });
  const summary = computeSummary([
    rc("inferred", "passed", { runner: inferred }),
    rc("measured", "passed", { runner: measured }),
    rc("missing", "passed", { runner: missing }),
  ]);
  assert.equal(summary.estimatedCostCases, 1);
  assert.equal(summary.measuredCostCases, 1);
  assert.equal(summary.missingCostCases, 1);
  assert.equal(summary.totalCostUsd, 0.03);
});

// ---- computeTelemetry: failRate vs errorRate ----

test("computeTelemetry splits grader failures from infrastructure errors", () => {
  const cases = [
    rc("a", "passed", { runner: runnerResult() }),
    rc("b", "failed"),
    rc("c", "failed"),
    rc("d", "error"),
  ];
  const t = computeTelemetry(cases);
  assert.equal(t.failRate, 0.5, "2 of 4 cases failed grading");
  assert.equal(t.errorRate, 0.25, "1 of 4 cases hit an infra error");
});

test("computeTelemetry: a run of honest grader failures is not an error storm", () => {
  const cases = [rc("a", "failed"), rc("b", "failed"), rc("c", "failed")];
  const t = computeTelemetry(cases);
  assert.equal(t.failRate, 1);
  assert.equal(t.errorRate, 0);
});

test("computeTelemetry handles the empty run", () => {
  const t = computeTelemetry([]);
  assert.equal(t.failRate, 0);
  assert.equal(t.errorRate, 0);
});

// ---- pass@k over multi-sample buckets ----

test("computeSummary pass@k math matches the unbiased estimator over per-case buckets", () => {
  // case A: 1/2 samples passed; case B: 2/2 samples passed.
  const cases = [
    rc("A", "passed", { sample: 0 }),
    rc("A", "failed", { sample: 1 }),
    rc("B", "passed", { sample: 0 }),
    rc("B", "passed", { sample: 1 }),
  ];
  const s = computeSummary(cases);
  assert.equal(s.samples, 2);
  assert.ok(close(s.passAt1!, mean([passAtK(2, 1, 1), passAtK(2, 2, 1)])));
  assert.ok(close(s.passAt1!, 0.75));
  assert.ok(close(s.passAtK!, mean([passAtK(2, 1, 2), passAtK(2, 2, 2)])));
  assert.ok(close(s.passAtK!, 1)); // with one failure among two samples, pass@2 is certain per estimator
  assert.equal(s.passPowK, 0.5, "only case B passed ALL its samples");
});

test("computeSummary pass@k on 3-sample buckets, cross-checked against lib/stats", () => {
  const cases = [
    rc("A", "passed", { sample: 0 }),
    rc("A", "failed", { sample: 1 }),
    rc("A", "failed", { sample: 2 }),
    rc("B", "failed", { sample: 0 }),
    rc("B", "failed", { sample: 1 }),
    rc("B", "failed", { sample: 2 }),
  ];
  const s = computeSummary(cases);
  assert.equal(s.samples, 3);
  assert.ok(close(s.passAt1!, mean([passAtK(3, 1, 1), passAtK(3, 0, 1)])));
  assert.ok(close(s.passAt1!, (1 / 3 + 0) / 2));
  assert.ok(close(s.passAtK!, mean([passAtK(3, 1, 3), passAtK(3, 0, 3)])));
  assert.ok(close(s.passAtK!, 0.5)); // A: pass@3=1 (one pass exists), B: 0
  assert.equal(s.passPowK, 0);
  const ci = s.passAt1Ci95!;
  assert.ok(ci.lo >= 0 && ci.hi <= 1 && ci.lo <= ci.hi);
});
