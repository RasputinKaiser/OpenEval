import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGrader, evaluate } from "../lib/grader";
import { extractJudgeJson } from "../lib/grader/judge";
import type { GraderResult, GraderSpec, RunnerResult } from "../lib/types";

function makeRunner(overrides: Partial<RunnerResult> = {}): RunnerResult {
  return {
    exitCode: 0,
    durationMs: 0,
    startedAt: 0,
    endedAt: 0,
    transcript: [],
    toolCalls: [],
    finalText: "",
    resultText: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
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

async function withWorkdir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "grader-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function ctxFor(workdir: string, overrides: Partial<{ runner: RunnerResult; transcriptText: string; fixtureSrc: string }> = {}) {
  return {
    workdir,
    runner: overrides.runner ?? makeRunner(),
    transcriptText: overrides.transcriptText ?? "",
    fixtureSrc: overrides.fixtureSrc,
  };
}

// ---- file_exists ----

test("file_exists passes when file present, fails when missing", async () => {
  await withWorkdir(async (dir) => {
    await fs.writeFile(path.join(dir, "a.txt"), "hi");
    const present = await runGrader({ type: "file_exists", path: "a.txt" }, ctxFor(dir));
    assert.equal(present.passed, true);
    const missing = await runGrader({ type: "file_exists", path: "nope.txt" }, ctxFor(dir));
    assert.equal(missing.passed, false);
  });
});

test("file_exists honors negate", async () => {
  await withWorkdir(async (dir) => {
    const r = await runGrader({ type: "file_exists", path: "gone.txt", negate: true }, ctxFor(dir));
    assert.equal(r.passed, true);
    await fs.writeFile(path.join(dir, "gone.txt"), "x");
    const r2 = await runGrader({ type: "file_exists", path: "gone.txt", negate: true }, ctxFor(dir));
    assert.equal(r2.passed, false);
  });
});

// ---- file_contains ----

test("file_contains matches regex and honors negate / missing / invalid", async () => {
  await withWorkdir(async (dir) => {
    await fs.writeFile(path.join(dir, "log.txt"), "hello world\nsecond line");
    assert.equal((await runGrader({ type: "file_contains", path: "log.txt", pattern: "^second" }, ctxFor(dir))).passed, true);
    assert.equal((await runGrader({ type: "file_contains", path: "log.txt", pattern: "nomatch" }, ctxFor(dir))).passed, false);
    assert.equal((await runGrader({ type: "file_contains", path: "log.txt", pattern: "nomatch", negate: true }, ctxFor(dir))).passed, true);
    assert.equal((await runGrader({ type: "file_contains", path: "absent.txt", pattern: "x" }, ctxFor(dir))).passed, false);
    const bad = await runGrader({ type: "file_contains", path: "log.txt", pattern: "(" }, ctxFor(dir));
    assert.equal(bad.passed, false);
    assert.match(bad.detail, /invalid regex/);
  });
});

// ---- file_eq ----

test("file_eq compares content with and without trim", async () => {
  await withWorkdir(async (dir) => {
    await fs.writeFile(path.join(dir, "v.txt"), "  value\n");
    assert.equal((await runGrader({ type: "file_eq", path: "v.txt", expected: "value", trim: true }, ctxFor(dir))).passed, true);
    assert.equal((await runGrader({ type: "file_eq", path: "v.txt", expected: "value" }, ctxFor(dir))).passed, false);
    assert.equal((await runGrader({ type: "file_eq", path: "v.txt", expected: "  value\n" }, ctxFor(dir))).passed, true);
  });
});

// ---- json_path ----

test("json_path resolves dotted keys and array indices", async () => {
  await withWorkdir(async (dir) => {
    await fs.writeFile(path.join(dir, "d.json"), JSON.stringify({ a: { b: 3 }, items: [{ name: "x" }, { name: "y" }] }));
    assert.equal((await runGrader({ type: "json_path", path: "d.json", jsonpath: "a.b", equals: 3 }, ctxFor(dir))).passed, true);
    assert.equal((await runGrader({ type: "json_path", path: "d.json", jsonpath: "a.b", equals: 4 }, ctxFor(dir))).passed, false);
    assert.equal((await runGrader({ type: "json_path", path: "d.json", jsonpath: "items[1].name", equals: "y" }, ctxFor(dir))).passed, true);
    const invalid = await runGrader({ type: "json_path", path: "d.json", jsonpath: "x", equals: 1 }, ctxFor(dir));
    assert.equal(invalid.passed, false);
  });
});

test("json_path fails on missing file and invalid JSON", async () => {
  await withWorkdir(async (dir) => {
    assert.equal((await runGrader({ type: "json_path", path: "none.json", jsonpath: "a", equals: 1 }, ctxFor(dir))).passed, false);
    await fs.writeFile(path.join(dir, "bad.json"), "{not json");
    const r = await runGrader({ type: "json_path", path: "bad.json", jsonpath: "a", equals: 1 }, ctxFor(dir));
    assert.equal(r.passed, false);
    assert.match(r.detail, /invalid JSON/);
  });
});

// ---- regex_match ----

test("regex_match reads final_text, stdout and transcript sources", async () => {
  await withWorkdir(async (dir) => {
    const runner = makeRunner({ finalText: "the answer is 42", resultText: "RESULT here" });
    assert.equal((await runGrader({ type: "regex_match", pattern: "answer is 42" }, ctxFor(dir, { runner }))).passed, true);
    assert.equal((await runGrader({ type: "regex_match", pattern: "RESULT here", source: "stdout" }, ctxFor(dir, { runner }))).passed, true);
    assert.equal((await runGrader({ type: "regex_match", pattern: "TOOL_USE", source: "transcript" }, ctxFor(dir, { runner, transcriptText: "TOOL_USE(Bash): ls" }))).passed, true);
    assert.equal((await runGrader({ type: "regex_match", pattern: "nope", negate: true }, ctxFor(dir, { runner }))).passed, true);
  });
});

// ---- files_unchanged ----

test("files_unchanged detects unchanged, modified, created, and deleted files", async () => {
  await withWorkdir(async (dir) => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "grader-fixture-"));
    try {
      await fs.writeFile(path.join(fixture, "keep.txt"), "same");
      await fs.writeFile(path.join(dir, "keep.txt"), "same");
      await fs.writeFile(path.join(fixture, "edit.txt"), "before");
      await fs.writeFile(path.join(dir, "edit.txt"), "after");
      await fs.writeFile(path.join(dir, "new.txt"), "created");
      await fs.writeFile(path.join(fixture, "gone.txt"), "was here");

      const ctx = ctxFor(dir, { fixtureSrc: fixture });
      assert.equal((await runGrader({ type: "files_unchanged", paths: ["keep.txt"] }, ctx)).passed, true);
      assert.equal((await runGrader({ type: "files_unchanged", paths: ["edit.txt"] }, ctx)).passed, false);
      assert.equal((await runGrader({ type: "files_unchanged", paths: ["new.txt"] }, ctx)).passed, false);
      assert.equal((await runGrader({ type: "files_unchanged", paths: ["gone.txt"] }, ctx)).passed, false);
    } finally {
      await fs.rm(fixture, { recursive: true, force: true });
    }
  });
});

// ---- file_deleted ----

test("file_deleted passes only when the file is absent", async () => {
  await withWorkdir(async (dir) => {
    assert.equal((await runGrader({ type: "file_deleted", path: "x.txt" }, ctxFor(dir))).passed, true);
    await fs.writeFile(path.join(dir, "x.txt"), "still here");
    assert.equal((await runGrader({ type: "file_deleted", path: "x.txt" }, ctxFor(dir))).passed, false);
  });
});

// ---- checksum ----

test("checksum matches sha256 and rejects a mismatch", async () => {
  await withWorkdir(async (dir) => {
    await fs.writeFile(path.join(dir, "c.txt"), "abc");
    // sha256("abc")
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert.equal((await runGrader({ type: "checksum", path: "c.txt", expected }, ctxFor(dir))).passed, true);
    assert.equal((await runGrader({ type: "checksum", path: "c.txt", expected: "deadbeef" }, ctxFor(dir))).passed, false);
  });
});

// ---- step ----

test("step matches min_count, at_index, before_tool, negate, input_includes", async () => {
  await withWorkdir(async (dir) => {
    const runner = makeRunner({
      toolCalls: [
        { id: "1", name: "Read", input: { path: "a.ts" } },
        { id: "2", name: "Edit", input: { path: "a.ts", text: "hello" } },
        { id: "3", name: "Bash", input: "npm test" },
      ],
    });
    const ctx = ctxFor(dir, { runner });
    assert.equal((await runGrader({ type: "step", tool: "Read", min_count: 1 }, ctx)).passed, true);
    assert.equal((await runGrader({ type: "step", tool: "Read", min_count: 2 }, ctx)).passed, false);
    assert.equal((await runGrader({ type: "step", tool: "Read", at_index: 0 }, ctx)).passed, true);
    assert.equal((await runGrader({ type: "step", tool: "Bash", at_index: 0 }, ctx)).passed, false);
    assert.equal((await runGrader({ type: "step", tool: "Read", before_tool: "Bash" }, ctx)).passed, true);
    assert.equal((await runGrader({ type: "step", tool: "Bash", before_tool: "Read" }, ctx)).passed, false);
    assert.equal((await runGrader({ type: "step", tool: "Delete", negate: true }, ctx)).passed, true);
    assert.equal((await runGrader({ type: "step", tool: "Bash", negate: true }, ctx)).passed, false);
    assert.equal((await runGrader({ type: "step", input_includes: "hello" }, ctx)).passed, true);
    assert.equal((await runGrader({ type: "step", input_includes_any: ["nope", "npm test"] }, ctx)).passed, true);
  });
});

// ---- exit_code / tests_pass ----

test("exit_code passes on 0 and fails on nonzero", async () => {
  await withWorkdir(async (dir) => {
    assert.equal((await runGrader({ type: "exit_code", command: "true" }, ctxFor(dir))).passed, true);
    assert.equal((await runGrader({ type: "exit_code", command: "exit 3" }, ctxFor(dir))).passed, false);
  });
});

test("tests_pass parses passed/failed counts", async () => {
  await withWorkdir(async (dir) => {
    const good = await runGrader({ type: "tests_pass", command: "echo '3 passed 0 failed'" }, ctxFor(dir));
    assert.equal(good.passed, true);
    assert.match(good.detail, /passed=3/);
    const bad = await runGrader({ type: "tests_pass", command: "echo '2 passed 1 failed'; exit 1" }, ctxFor(dir));
    assert.equal(bad.passed, false);
    assert.match(bad.detail, /failed=1/);
  });
});

// ---- manual / unknown ----

test("manual grader is pending (not passed)", async () => {
  await withWorkdir(async (dir) => {
    const r = await runGrader({ type: "manual", note: "eyeball it" }, ctxFor(dir));
    assert.equal(r.passed, false);
    assert.match(r.detail, /manual review/i);
  });
});

test("unknown grader type fails", async () => {
  await withWorkdir(async (dir) => {
    const r = await runGrader({ type: "bogus" } as unknown as GraderSpec, ctxFor(dir));
    assert.equal(r.passed, false);
    assert.match(r.detail, /unknown grader type/);
  });
});

// ---- extractJudgeJson (robust judge-reply parsing) ----

test("extractJudgeJson parses clean JSON", () => {
  assert.deepEqual(extractJudgeJson('{"passed": true, "score": 0.9}'), { passed: true, score: 0.9 });
});

test("extractJudgeJson recovers JSON wrapped in prose or code fences", () => {
  assert.deepEqual(
    extractJudgeJson('Here is my verdict:\n```json\n{"passed": false, "score": 0.2}\n```\nThanks!'),
    { passed: false, score: 0.2 },
  );
  assert.deepEqual(
    extractJudgeJson('I considered the rubric. Final answer: {"passed": true, "score": 1}'),
    { passed: true, score: 1 },
  );
});

test("extractJudgeJson picks the actual object when reasoning contains stray braces", () => {
  const reply = 'The set {a, b} matters here. {"passed": true, "score": 0.8, "reason": "ok"}';
  const v = extractJudgeJson(reply);
  assert.equal(v?.passed, true);
  assert.equal(v?.score, 0.8);
});

test("extractJudgeJson returns null for non-JSON and ignores bare arrays", () => {
  assert.equal(extractJudgeJson("no json here"), null);
  assert.equal(extractJudgeJson(""), null);
  assert.equal(extractJudgeJson("[1, 2, 3]"), null);
});

// ---- evaluate() ----

function res(passed: boolean, spec: Partial<GraderSpec> = {}): GraderResult {
  return { spec: { type: "file_exists", path: "x", ...spec } as GraderSpec, passed, detail: "", durationMs: 1, score: passed ? 1 : 0 };
}

test("evaluate weights results and applies pass_threshold", () => {
  // weight 3 passing + weight 1 failing => ratio 0.75
  const e = evaluate([res(true, { weight: 3 }), res(false, { weight: 1 })], 0.75);
  assert.equal(e.passRatio, 0.75);
  assert.equal(e.passed, true);
  // same ratio below a stricter threshold => fail
  assert.equal(evaluate([res(true, { weight: 3 }), res(false, { weight: 1 })], 0.8).passed, false);
});

test("evaluate defaults each weight to 1", () => {
  const e = evaluate([res(true), res(true), res(false)], 0.5);
  assert.equal(Math.round(e.passRatio * 100), 67);
  assert.equal(e.passed, true);
});

test("evaluate fails when a forbidden grader fails, regardless of ratio", () => {
  const e = evaluate([res(true, { weight: 9 }), res(false, { weight: 1, forbidden: true })], 0.5);
  assert.equal(e.passed, false);
  // a passing forbidden grader does not force failure
  assert.equal(evaluate([res(true, { weight: 1, forbidden: true })], 1).passed, true);
});
