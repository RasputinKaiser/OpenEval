import test from "node:test";
import assert from "node:assert/strict";
import type { GraderResult, RunCaseRecord } from "../lib/types";
import {
  clampScore,
  confidenceGrade,
  evidenceTierForSpec,
  summarizeCaseTrust,
  summarizeEvidence,
  summarizeRunConfidence,
} from "../components/run-detail/trust";
import { collapseStorageKey, parseCollapsedMap } from "../components/run-detail/collapse";
import { inlineStyles } from "../components/run-detail/artifact-utils";

function makeCase(over: Partial<RunCaseRecord> = {}, defOver: Partial<RunCaseRecord["case_def"]> = {}): RunCaseRecord {
  return {
    id: "rc-1",
    run_id: "run-1",
    case_id: "case-1",
    case_name: "Case 1",
    category: "agentic-swe",
    status: "passed",
    started_at: 1,
    ended_at: 2,
    workdir_path: "",
    transcript_path: null,
    runner_kind: "headless",
    runner_result: null,
    grader_result: null,
    evaluation: null,
    error_msg: null,
    case_def: {
      id: "case-1",
      name: "Case 1",
      category: "agentic-swe",
      prompt: "noop",
      graders: [],
      ...defOver,
    } as RunCaseRecord["case_def"],
    ...over,
  };
}

function graderResult(over: Partial<GraderResult> & { spec: GraderResult["spec"] }): GraderResult {
  return { passed: true, detail: "", durationMs: 1, score: 1, ...over };
}

test("evidenceTierForSpec maps spec types to tiers", () => {
  assert.equal(evidenceTierForSpec({ type: "step" }), "trace");
  assert.equal(evidenceTierForSpec({ type: "rubric_llm", rubric: "r" }), "llm_judge");
  assert.equal(evidenceTierForSpec({ type: "manual" }), "manual");
  assert.equal(evidenceTierForSpec({ type: "exit_code", command: "true" }), "deterministic");
  assert.equal(evidenceTierForSpec({ type: "file_contains", path: "a", pattern: "b" }), "deterministic");
});

test("summarizeEvidence counts per tier and honors explicit evidenceTier", () => {
  const counts = summarizeEvidence([
    graderResult({ spec: { type: "exit_code", command: "true" } }),
    graderResult({ spec: { type: "exit_code", command: "false" }, passed: false }),
    graderResult({ spec: { type: "step" } }),
    // explicit evidenceTier wins over spec-derived tier
    graderResult({ spec: { type: "exit_code", command: "x" }, evidenceTier: "visual" }),
  ]);
  assert.deepEqual(counts.deterministic, { passed: 1, total: 2 });
  assert.deepEqual(counts.trace, { passed: 1, total: 1 });
  assert.deepEqual(counts.visual, { passed: 1, total: 1 });
  assert.deepEqual(counts.llm_judge, { passed: 0, total: 0 });
});

test("summarizeCaseTrust flags all structural weaknesses on a bare case", () => {
  const trust = summarizeCaseTrust(makeCase());
  assert.equal(trust.hasOracle, false);
  assert.equal(trust.hasKnownBad, false);
  assert.equal(trust.hasProofBackstop, false);
  assert.ok(trust.weaknesses.includes("missing oracle"));
  assert.ok(trust.weaknesses.includes("no known-bad"));
  assert.ok(trust.weaknesses.includes("no deterministic/trace proof"));
  assert.ok(trust.weaknesses.includes("no budget"));
});

test("summarizeCaseTrust: fully contracted case has no weaknesses and high score", () => {
  const rc = makeCase(
    {
      grader_result: {
        passed: true,
        passRatio: 1,
        durationMs: 10,
        results: [graderResult({ spec: { type: "exit_code", command: "true" } })],
      },
    },
    {
      oracle: { solve: "fix.sh", known_bad: ["noop"] },
      budget: { max_turns: 10 },
    },
  );
  const trust = summarizeCaseTrust(rc);
  assert.deepEqual(trust.weaknesses, []);
  assert.equal(trust.hasProofBackstop, true);
  assert.ok(trust.score >= 90, `expected >=90, got ${trust.score}`);
  assert.equal(trust.grade, "High confidence");
});

test("summarizeCaseTrust flags LLM judge without deterministic backstop", () => {
  const rc = makeCase({
    grader_result: {
      passed: true,
      passRatio: 1,
      durationMs: 10,
      results: [graderResult({ spec: { type: "rubric_llm", rubric: "r" } })],
    },
  });
  const trust = summarizeCaseTrust(rc);
  assert.ok(trust.weaknesses.includes("LLM judge lacks backstop"));
});

test("summarizeRunConfidence aggregates coverage and caps topWeaknesses at 5", () => {
  const cases = Array.from({ length: 4 }, (_, i) => makeCase({ id: `rc-${i}`, case_id: `case-${i}` }));
  const summary = summarizeRunConfidence(cases);
  assert.equal(summary.totalCases, 4);
  assert.equal(summary.deterministicCoverage, 0);
  assert.equal(summary.knownBadCoverage, 0);
  assert.equal(summary.weakCaseCount, 4);
  assert.ok(summary.topWeaknesses.length <= 5);
  // every bare case shares the same weaknesses, so counts equal case count
  assert.equal(summary.topWeaknesses[0].count, 4);
});

test("summarizeRunConfidence: empty run does not divide by zero", () => {
  const summary = summarizeRunConfidence([]);
  assert.equal(summary.totalCases, 0);
  assert.equal(summary.deterministicCoverage, 0);
  assert.equal(summary.visualCoverage, 100);
  assert.ok(Number.isFinite(summary.score));
});

test("clampScore bounds and rounds", () => {
  assert.equal(clampScore(-5), 0);
  assert.equal(clampScore(120), 100);
  assert.equal(clampScore(59.6), 60);
});

test("confidenceGrade thresholds", () => {
  assert.equal(confidenceGrade(90), "High confidence");
  assert.equal(confidenceGrade(75), "Solid confidence");
  assert.equal(confidenceGrade(60), "Needs review");
  assert.equal(confidenceGrade(59), "Weak proof");
});

test("collapseStorageKey is per run", () => {
  assert.equal(collapseStorageKey("abc123"), "openeval.run-detail.collapsed.abc123");
  assert.notEqual(collapseStorageKey("a"), collapseStorageKey("b"));
});

test("parseCollapsedMap tolerates junk and keeps only booleans", () => {
  assert.deepEqual(parseCollapsedMap(null), {});
  assert.deepEqual(parseCollapsedMap(""), {});
  assert.deepEqual(parseCollapsedMap("not json{"), {});
  assert.deepEqual(parseCollapsedMap("[1,2]"), {});
  assert.deepEqual(parseCollapsedMap('"str"'), {});
  assert.deepEqual(
    parseCollapsedMap('{"graders":true,"answer":false,"evil":"yes","n":3}'),
    { graders: true, answer: false },
  );
});

test("inlineStyles injects before </head> when present, else prepends", () => {
  assert.equal(
    inlineStyles("<html><head></head><body>x</body></html>", "b{color:red}"),
    "<html><head><style>b{color:red}</style></head><body>x</body></html>",
  );
  assert.equal(inlineStyles("<div>x</div>", "b{}"), "<style>b{}</style><div>x</div>");
});
