import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseRubricJudgeVerdict,
  serializeRubricJudgeFailure,
} from "../lib/grader/judge";
import { runGrader } from "../lib/grader";
import type { RunnerResult } from "../lib/types";

test("rubric verdict parsing validates bounded fields while retaining boolean-only compatibility", () => {
  assert.deepEqual(
    parseRubricJudgeVerdict('Here is the result: {"passed":true,"score":0.9,"reason":"specific"}').verdict,
    { passed: true, score: 0.9, reason: "specific" },
  );
  assert.deepEqual(parseRubricJudgeVerdict('{"passed":false}').verdict, { passed: false });
  assert.deepEqual(parseRubricJudgeVerdict('{"score":0.4}').verdict, { score: 0.4 });
});

test("rubric verdict parsing blocks malformed types, out-of-range scores, and undeclared fields", () => {
  for (const reply of [
    '{"passed":"true","score":1}',
    '{"passed":true,"score":1.1}',
    '{"passed":true,"reason":""}',
    '{"passed":true,"extra":"untrusted field"}',
    '{"reason":"missing verdict fields"}',
  ]) {
    const parsed = parseRubricJudgeVerdict(reply);
    assert.equal(parsed.verdict, null, reply);
    assert.match(parsed.error ?? "", /invalid rubric verdict|verdict must include/i, reply);
  }
});

test("rubric judge failure receipt records blocked status, backend, code, and bounded response", () => {
  const receipt = JSON.parse(serializeRubricJudgeFailure({
    harness: "openrouter",
    model: "test/model",
    code: "invalid_verdict",
    detail: "x".repeat(900),
    response: "y".repeat(900),
  })) as {
    contract: string;
    version: number;
    status: string;
    backend: { harness: string; model: string | null };
    failure: { code: string; detail: string };
    response?: string;
  };

  assert.equal(receipt.contract, "openeval.rubric-judge");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.status, "blocked");
  assert.deepEqual(receipt.backend, { harness: "openrouter", model: "test/model" });
  assert.equal(receipt.failure.code, "invalid_verdict");
  assert.equal(receipt.failure.detail.length, 500);
  assert.equal(receipt.response?.length, 500);
  const backendFailure = JSON.parse(serializeRubricJudgeFailure({
    harness: "codex",
    code: "backend_unavailable",
    detail: "judge exited 1",
  })) as { failure?: { code?: string }; backend?: { model?: string | null } };
  assert.equal(backendFailure.failure?.code, "backend_unavailable");
  assert.equal(backendFailure.backend?.model, null);
});

test("rubric grader records malformed backend replies as infrastructure, not agent evidence", async () => {
  const previousFetch = globalThis.fetch;
  const saved = {
    harness: process.env.JUDGE_HARNESS,
    model: process.env.JUDGE_MODEL,
    key: process.env.OPENROUTER_API_KEY,
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "judge-verdict-test-"));
  process.env.JUDGE_HARNESS = "openrouter";
  process.env.JUDGE_MODEL = "test/model";
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"passed":"yes","score":1}' } }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const runner = {
      finalText: "agent answer",
      resultText: "agent answer",
      isError: false,
      toolCalls: [],
    } as unknown as RunnerResult;
    const result = await runGrader(
      { type: "rubric_llm", rubric: "The answer is specific." },
      { workdir: dir, runner, transcriptText: "" },
    );
    assert.equal(result.passed, false);
    assert.equal(result.infraError, true);
    assert.match(result.detail, /invalid rubric verdict/);
    const receipt = JSON.parse(result.output ?? "{}") as { status?: string; failure?: { code?: string } };
    assert.equal(receipt.status, "blocked");
    assert.equal(receipt.failure?.code, "invalid_verdict");
  } finally {
    globalThis.fetch = previousFetch;
    if (saved.harness === undefined) delete process.env.JUDGE_HARNESS;
    else process.env.JUDGE_HARNESS = saved.harness;
    if (saved.model === undefined) delete process.env.JUDGE_MODEL;
    else process.env.JUDGE_MODEL = saved.model;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
