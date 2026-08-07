import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeJudgeSelection, checkJudgeSelection, resolveJudgeSelection } from "../lib/grader/selection";
import { parseRubricJudgeVerdict, runJudgeBackend } from "../lib/grader/judge";
import { runGrader } from "../lib/grader";
import type { RunnerResult } from "../lib/types";
import { _setCacheDbForTest, loadJudgeJob, saveJudgeJob } from "../lib/live-cache";

test("judge selection is source-scoped and explicit job choice outranks environment", () => {
  const selection = resolveJudgeSelection({
    environment: { source: "openrouter", model: "wrong/model" },
    job: { source: "stub", model: "deterministic-v1" },
  });
  assert.equal(selection.source, "stub");
  assert.equal(selection.model, "deterministic-v1");
  assert.equal(selection.resolution, "job");
  assert.equal(Object.isFrozen(selection), true);
});

test("case-level judge_harness aliases are normalized before readiness validation", () => {
  const selection = resolveJudgeSelection({
    casePin: { judge_harness: "claude", judge_model: "sonnet" },
    job: { source: "stub", model: "deterministic-v1" },
  });
  assert.equal(selection.source, "claude-code");
  assert.equal(selection.model, "sonnet");
  assert.equal(selection.resolution, "case");
});

test("deterministic stub produces a valid rubric receipt without provider access", async () => {
  const selection = await checkJudgeSelection(makeJudgeSelection({ source: "stub", model: "deterministic-v1", resolution: "job" }));
  assert.equal(selection.readiness, "ready");
  const result = await runJudgeBackend({ harness: selection.source, model: selection.model, reasoningEffort: selection.reasoningEffort, prompt: "JUDGE_PROMPT_MARKER met a rubric", timeoutMs: 100 });
  assert.equal(result.ok, true);
  assert.equal(parseRubricJudgeVerdict(result.text).verdict?.reason, "deterministic judge stub");
});

test("rubric results retain the bounded structured deterministic receipt", async () => {
  const selection = await checkJudgeSelection(makeJudgeSelection({ source: "stub", model: "deterministic-v1", resolution: "job" }));
  const runner = { finalText: "agent answer", resultText: "agent answer", isError: false, toolCalls: [] } as unknown as RunnerResult;
  const result = await runGrader(
    { type: "rubric_llm", rubric: "The answer is specific." },
    { workdir: "/tmp", runner, transcriptText: "", judgeSelection: selection },
  );
  assert.equal(result.judgeSelection?.source, "stub");
  assert.equal(result.judgeReceipt?.contract, "openeval.rubric-judge");
  assert.equal(result.judgeReceipt?.selection.model, "deterministic-v1");
  assert.equal(result.judgeReceipt?.transport, "stub");
  assert.equal(result.judgeReceipt?.failure, null);
  assert.equal(typeof result.judgeReceipt?.score, "number");
});

test("timeline job persists structured judge selection across cache reload", () => {
  const conn = new Database(":memory:");
  _setCacheDbForTest(conn);
  try {
    const selection = makeJudgeSelection({ source: "stub", model: "deterministic-v1", resolution: "job" });
    saveJudgeJob({
      state: "running", total: 1, done: 0, judged: 0, failed: 0,
      judge: selection.judgeName, selection, startedAt: 1, finishedAt: null,
      lastError: null, queue: ["/tmp/session.jsonl"], leaseId: "lease", ownerPid: process.pid, heartbeatAt: Date.now(),
    });
    assert.deepEqual(loadJudgeJob()?.selection, selection);
    assert.equal(loadJudgeJob()?.selection?.source, "stub");
    assert.equal(loadJudgeJob()?.selection?.model, "deterministic-v1");
  } finally {
    _setCacheDbForTest(null);
    conn.close();
  }
});
