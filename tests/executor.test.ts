import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaseDefinition, GraderResult, RunnerResult } from "../lib/types";

/**
 * Executor status semantics, exercised two ways:
 *
 * 1. REAL executeCase runs against a temp-registered harness descriptor whose
 *    binary is this Node executable running a tiny stream-json emitter script.
 *    Hermetic: no agent CLI is ever spawned, and `harness` is passed as
 *    undefined so loadHarnessInfo skips discoverHarnesses (which would
 *    --version-probe the machine's real claude/codex binaries). The default
 *    adapter is pinned to the temp descriptor via OPENEVAL_DEFAULT_HARNESS.
 *
 * 2. Seam tests on runGrader/evaluate with crafted RunnerResults for the
 *    text-source rules that don't need a process at all.
 *
 * All cwd-rooted state (eval.db, workdirs, transcripts, harnesses dir) lands in
 * a mkdtemp root: OPENEVAL_DATA_ROOT + chdir happen BEFORE the lib modules are
 * (dynamically) imported.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-executor-"));
process.env.OPENEVAL_DATA_ROOT = path.join(tmpRoot, "state");
process.env.OPENEVAL_DEFAULT_HARNESS = "testnode";
process.chdir(tmpRoot);

const emitScript = path.join(tmpRoot, "emit-stream-json.mjs");
fs.writeFileSync(emitScript, [
  'const prompt = process.argv[2] || "";',
  'if (prompt.includes("MODE=error")) {',
  '  console.error("SECRET_DIAGNOSTIC: harness exploded before any result event");',
  "  process.exit(1);",
  "}",
  "const turnsMatch = prompt.match(/TURNS=(\\d+)/);",
  "const turns = turnsMatch ? Number(turnsMatch[1]) : 1;",
  "const line = (o) => console.log(JSON.stringify(o));",
  'line({ type: "system", subtype: "init", session_id: "sess-test", model: "test-model" });',
  'line({ type: "assistant", message: { content: [{ type: "text", text: "hello world" }] } });',
  'line({ type: "result", result: "done", duration_ms: 5, num_turns: turns, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, is_error: false });',
].join("\n"));

const harnessesDir = path.join(tmpRoot, "state", "harnesses");
fs.mkdirSync(harnessesDir, { recursive: true });
fs.writeFileSync(path.join(harnessesDir, "testnode.harness.json"), JSON.stringify({
  id: "testnode",
  label: "Test Node Harness",
  binNames: ["node"],
  defaultBin: process.execPath,
  parser: "claude-stream-json",
  argTemplate: [emitScript, "{prompt}"],
}));

test.after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// run_cases has a FOREIGN KEY to runs and this SQLite build enforces it.
async function ensureRun(id: string): Promise<void> {
  const db = await import("../lib/db");
  if (!db.getRun(id)) {
    db.insertRun({ id, name: id, status: "running", created_at: Date.now(), ended_at: null, params: { runner: "headless", parallel: 1 }, summary: null });
  }
}

function caseDef(overrides: Partial<CaseDefinition> & { id: string; graders: CaseDefinition["graders"] }): CaseDefinition {
  return {
    name: overrides.id,
    category: "single-tool",
    prompt: "MODE=ok TURNS=1",
    runner: { timeout_seconds: 60 },
    ...overrides,
  } as CaseDefinition;
}

function errorRunnerResult(overrides: Partial<RunnerResult> = {}): RunnerResult {
  return {
    exitCode: 1,
    durationMs: 10,
    startedAt: Date.now(),
    endedAt: Date.now(),
    transcript: [],
    toolCalls: [],
    finalText: "",
    resultText: "Runner exited without producing a result event.\nstderr:\nTypeError: SECRET_DIAGNOSTIC at foo.js:1",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
    stopReason: null,
    sessionId: null,
    model: null,
    isError: true,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
    ...overrides,
  };
}

// ---- real executeCase runs ----

test("executeCase: clean run with passing grader lands status=passed and parsed usage", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-pass",
    prompt: "MODE=ok TURNS=2",
    graders: [{ type: "regex_match", pattern: "hello", source: "final_text" }],
  });
  const rec = await executeCase("run-exec", def, "headless", 1, undefined, 0, undefined);
  assert.equal(rec.status, "passed");
  assert.equal(rec.runner_result?.finalText, "hello world");
  assert.equal(rec.runner_result?.usage.outputTokens, 5);
  assert.equal(rec.runner_result?.numTurns, 2);
  assert.equal(rec.evaluation?.passed, true);
  assert.equal(rec.budget_exceeded, false);
});

test("executeCase: budget exceeded maps to failed even when graders pass", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-budget",
    prompt: "MODE=ok TURNS=5",
    budget: { max_turns: 1 },
    graders: [{ type: "regex_match", pattern: "hello", source: "final_text" }],
  });
  const rec = await executeCase("run-exec", def, "headless", 2, undefined, 0, undefined);
  assert.equal(rec.status, "failed");
  assert.equal(rec.budget_exceeded, true);
  assert.ok(rec.error_msg?.includes("Budget exceeded"), `error_msg carries the reason: ${rec.error_msg}`);
  assert.equal(rec.evaluation?.passed, true, "graders themselves passed");
});

test("executeCase: runner failure keeps diagnostics out of finalText and lands status=error", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-error",
    prompt: "MODE=error",
    // The diagnostic text WOULD match this pattern — it must not count.
    graders: [{ type: "regex_match", pattern: "SECRET_DIAGNOSTIC", source: "final_text" }],
  });
  const rec = await executeCase("run-exec", def, "headless", 3, undefined, 0, undefined);
  assert.equal(rec.status, "error");
  assert.equal(rec.runner_result?.isError, true);
  assert.equal(rec.runner_result?.finalText, "", "no agent text was produced");
  assert.ok(rec.runner_result?.resultText.includes("SECRET_DIAGNOSTIC"), "diagnostics live in resultText");
  assert.equal(rec.grader_result?.results[0]?.passed, false, "regex on final_text must not match diagnostics");
  assert.ok(rec.error_msg?.includes("SECRET_DIAGNOSTIC"), `error_msg carries runner diagnostics: ${rec.error_msg}`);
});

test("executeCase: runner failure cannot pass through absence-only graders", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-error-vacuous",
    prompt: "MODE=error",
    graders: [{ type: "regex_match", pattern: "forbidden output", source: "final_text", negate: true }],
  });
  const rec = await executeCase("run-exec", def, "headless", 30, undefined, 0, undefined);
  assert.equal(rec.evaluation?.passed, true, "the absence grader remains truthful about empty output");
  assert.equal(rec.status, "error", "runner failure wins over a vacuous pass");
});

test("executeCase: grader infra failure (files_unchanged without fixture) maps to error, not failed", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-infra",
    prompt: "MODE=ok TURNS=1",
    graders: [{ type: "files_unchanged", paths: ["a.txt"] }],
  });
  const rec = await executeCase("run-exec", def, "headless", 4, undefined, 0, undefined);
  assert.equal(rec.status, "error");
  assert.equal(rec.grader_result?.results[0]?.infraError, true);
  assert.ok(rec.error_msg?.includes("fixture baseline"));
});

test("executeCase: genuine agent failure is not masked by an infra-failed grader", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-agent-and-infra-fail",
    prompt: "MODE=ok TURNS=1",
    graders: [
      { type: "regex_match", pattern: "definitely absent", source: "final_text" },
      { type: "files_unchanged", paths: ["a.txt"] },
    ],
  });
  const rec = await executeCase("run-exec", def, "headless", 31, undefined, 0, undefined);
  assert.equal(rec.status, "failed");
});

test("executeCase: pass threshold cannot absorb an infra-failed grader", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-exec");
  const def = caseDef({
    id: "exec-infra-threshold",
    prompt: "MODE=ok TURNS=1",
    pass_threshold: 0.5,
    graders: [
      { type: "regex_match", pattern: "hello", source: "final_text", weight: 9 },
      { type: "files_unchanged", paths: ["a.txt"], weight: 1 },
    ],
  });
  const rec = await executeCase("run-exec", def, "headless", 32, undefined, 0, undefined);
  assert.equal(rec.evaluation?.passed, true);
  assert.equal(rec.status, "error");
});

// ---- runGrader / evaluate seam ----

test("regex_match on an error run grades only genuine agent text, never diagnostics", async () => {
  const { runGrader } = await import("../lib/grader");
  const runner = errorRunnerResult();
  const ctx = { workdir: tmpRoot, runner, transcriptText: "" };

  const finalText = await runGrader({ type: "regex_match", pattern: "SECRET_DIAGNOSTIC", source: "final_text" }, ctx);
  assert.equal(finalText.passed, false, "final_text source must not see resultText diagnostics");

  const stdout = await runGrader({ type: "regex_match", pattern: "SECRET_DIAGNOSTIC", source: "stdout" }, ctx);
  assert.equal(stdout.passed, false, "stdout source must not see resultText diagnostics on error runs");

  // A negated forbidden pattern must not false-fire off the diagnostics either.
  const negated = await runGrader({ type: "regex_match", pattern: "SECRET_DIAGNOSTIC", source: "final_text", negate: true, forbidden: true }, ctx);
  assert.equal(negated.passed, true, "no false forbidden violation from runner diagnostics");
});

test("regex_match still grades partial agent text preserved on an error run", async () => {
  const { runGrader } = await import("../lib/grader");
  const runner = errorRunnerResult({ finalText: "partial agent answer 42" });
  const ctx = { workdir: tmpRoot, runner, transcriptText: "" };
  const r = await runGrader({ type: "regex_match", pattern: "answer 42", source: "final_text" }, ctx);
  assert.equal(r.passed, true);
});

test("evaluate: a failed infraError grader keeps the evaluation failed", async () => {
  const { evaluate } = await import("../lib/grader");
  const infraFail: GraderResult = {
    spec: { type: "rubric_llm", rubric: "did the agent succeed?" },
    passed: false,
    detail: "LLM judge unavailable via codex/gpt-5.5: judge timed out",
    durationMs: 5,
    score: 0,
    infraError: true,
  };
  const evaluation = evaluate([infraFail], 1);
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.passRatio, 0);
});

test("evaluate: a failed forbidden grader vetoes a pass even when the threshold is met", async () => {
  const { evaluate } = await import("../lib/grader");
  const passOk: GraderResult = { spec: { type: "file_exists", path: "a" }, passed: true, detail: "", durationMs: 1, score: 1 };
  const forbiddenFail: GraderResult = { spec: { type: "regex_match", pattern: "rm -rf", negate: true, forbidden: true }, passed: false, detail: "", durationMs: 1, score: 0 };
  const evaluation = evaluate([passOk, forbiddenFail], 0.5);
  assert.ok(evaluation.passRatio >= 0.5);
  assert.equal(evaluation.passed, false);
});
