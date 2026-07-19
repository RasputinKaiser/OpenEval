import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { defaultJudgeModel, resolveJudge, validJudgeScore } from "../lib/grader/judge";
import { saveAppSettings } from "../lib/settings";
import {
  _setCacheDbForTest,
  MAX_JUDGE_ATTEMPTS,
  recordJudgeFailure,
  loadJudgeFailures,
  clearJudgeFailure,
  saveJudgment,
} from "../lib/live-cache";
import { JUDGE_PROMPT_VERSION, judgeSkipSet, loadCurrentJudgments } from "../lib/insights/judge";

// ---- validJudgeScore ----

test("validJudgeScore accepts only finite numbers within 0..1", () => {
  assert.equal(validJudgeScore(0), 0);
  assert.equal(validJudgeScore(1), 1);
  assert.equal(validJudgeScore(0.5), 0.5);
});

test("validJudgeScore rejects out-of-range, non-numeric, and malformed scores", () => {
  assert.equal(validJudgeScore(-0.1), null);
  assert.equal(validJudgeScore(1.5), null);
  assert.equal(validJudgeScore(NaN), null);
  assert.equal(validJudgeScore(Infinity), null);
  assert.equal(validJudgeScore("0.5"), null);
  assert.equal(validJudgeScore(null), null);
  assert.equal(validJudgeScore(undefined), null);
});

// ---- resolveJudge env chain ----

// A previously KILLED run can leave the settings file behind (the precedence
// test below only cleans it up in a finally), which would poison every
// resolveJudge default here. Remove it unconditionally before the tests run.
{
  const root = process.env.OPENEVAL_DATA_ROOT ?? ".test-data";
  fs.rmSync(path.join(process.cwd(), root, "data", "settings.json"), { force: true });
}

const JUDGE_ENV_KEYS = ["JUDGE_HARNESS", "JUDGE_MODEL", "OPENROUTER_API_KEY"] as const;

function withEnv(vars: Partial<Record<(typeof JUDGE_ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of JUDGE_ENV_KEYS) {
    saved[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of JUDGE_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("resolveJudge: JUDGE_HARNESS override wins even when an OpenRouter key exists", () => {
  withEnv({ JUDGE_HARNESS: "my-harness", OPENROUTER_API_KEY: "sk-test" }, () => {
    const r = resolveJudge();
    assert.equal(r.harness, "my-harness");
    assert.equal(r.model, undefined);
    assert.equal(r.judgeName, "my-harness");
  });
});

test("resolveJudge: explicit JUDGE_HARNESS=openrouter still gets the free default model", () => {
  withEnv({ JUDGE_HARNESS: "openrouter" }, () => {
    const r = resolveJudge();
    assert.equal(r.harness, "openrouter");
    assert.equal(r.model, "tencent/hy3:free");
    assert.equal(r.judgeName, "openrouter/tencent/hy3:free");
  });
});

test("resolveJudge: OPENROUTER_API_KEY selects the openrouter backend by default", () => {
  withEnv({ OPENROUTER_API_KEY: "sk-test" }, () => {
    const r = resolveJudge();
    assert.equal(r.harness, "openrouter");
    assert.equal(r.model, "tencent/hy3:free");
  });
});

test("resolveJudge: Settings-page source and model are used beneath explicit env overrides", () => {
  const root = process.env.OPENEVAL_DATA_ROOT ?? ".test-data";
  const settingsPath = path.join(process.cwd(), root, "data", "settings.json");
  const previous = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : null;
  try {
    saveAppSettings({ judgeSource: "codex", judgeModel: "gpt-5.5" });
    withEnv({ JUDGE_HARNESS: undefined, JUDGE_MODEL: undefined, OPENROUTER_API_KEY: "sk-test" }, () => {
      const r = resolveJudge();
      assert.equal(r.harness, "codex");
      assert.equal(r.model, "gpt-5.5");
      assert.equal(r.judgeName, "codex/gpt-5.5");
    });
  } finally {
    if (previous === null) fs.rmSync(settingsPath, { force: true });
    else fs.writeFileSync(settingsPath, previous);
  }
});

test("resolveJudge: with no env at all, falls back to codex with a pinned model", () => {
  withEnv({}, () => {
    const r = resolveJudge();
    assert.equal(r.harness, "codex");
    assert.equal(r.model, "gpt-5.5");
    assert.equal(r.judgeName, "codex/gpt-5.5");
  });
});

test("resolveJudge: JUDGE_MODEL overrides the default model in every branch", () => {
  withEnv({ OPENROUTER_API_KEY: "sk-test", JUDGE_MODEL: "custom/model" }, () => {
    const r = resolveJudge();
    assert.equal(r.harness, "openrouter");
    assert.equal(r.model, "custom/model");
    assert.equal(r.judgeName, "openrouter/custom/model");
  });
  withEnv({ JUDGE_MODEL: "custom-codex-model" }, () => {
    const r = resolveJudge();
    assert.equal(r.harness, "codex");
    assert.equal(r.model, "custom-codex-model");
  });
  withEnv({ JUDGE_HARNESS: "my-harness", JUDGE_MODEL: "m1" }, () => {
    const r = resolveJudge();
    assert.equal(r.judgeName, "my-harness/m1");
  });
});

test("explicit judge harness overrides retain safe per-harness model defaults", () => {
  assert.equal(defaultJudgeModel("codex"), "gpt-5.5");
  assert.equal(defaultJudgeModel("openrouter"), "tencent/hy3:free");
  assert.equal(defaultJudgeModel("custom"), undefined);
});

// ---- judge_failures ledger (in-memory sqlite via the test hook) ----

function withMemoryCacheDb(fn: () => void) {
  _setCacheDbForTest(new Database(":memory:"));
  try {
    fn();
  } finally {
    _setCacheDbForTest(null);
  }
}

test("recordJudgeFailure increments attempts per call", () => {
  withMemoryCacheDb(() => {
    recordJudgeFailure("/tmp/s1.jsonl", "timeout");
    assert.equal(loadJudgeFailures().get("/tmp/s1.jsonl")?.attempts, 1);
    recordJudgeFailure("/tmp/s1.jsonl", "timeout again");
    const f = loadJudgeFailures().get("/tmp/s1.jsonl");
    assert.equal(f?.attempts, 2);
    assert.equal(f?.lastError, "timeout again");
  });
});

test("permanent failures jump straight to MAX_JUDGE_ATTEMPTS", () => {
  withMemoryCacheDb(() => {
    recordJudgeFailure("/tmp/gone.jsonl", "file no longer exists", { permanent: true });
    const f = loadJudgeFailures().get("/tmp/gone.jsonl");
    assert.equal(f?.attempts, MAX_JUDGE_ATTEMPTS);
    assert.equal(f?.permanent, true);
  });
});

test("clearJudgeFailure removes the ledger row", () => {
  withMemoryCacheDb(() => {
    recordJudgeFailure("/tmp/s2.jsonl", "429");
    assert.ok(loadJudgeFailures().has("/tmp/s2.jsonl"));
    clearJudgeFailure("/tmp/s2.jsonl");
    assert.equal(loadJudgeFailures().has("/tmp/s2.jsonl"), false);
  });
});

test("loadJudgeFailures round-trips file, attempts, error, and timestamp", () => {
  withMemoryCacheDb(() => {
    const before = Date.now();
    recordJudgeFailure("/tmp/round.jsonl", "some judge error");
    const f = loadJudgeFailures().get("/tmp/round.jsonl");
    assert.ok(f);
    assert.equal(f.file, "/tmp/round.jsonl");
    assert.equal(f.attempts, 1);
    assert.equal(f.lastError, "some judge error");
    assert.ok(f.lastAttemptAt >= before && f.lastAttemptAt <= Date.now());
  });
});

test("judgeSkipSet contains current judgments and permanent file failures, while transient backend failures recover", () => {
  withMemoryCacheDb(() => {
    saveJudgment({
      file: "/tmp/judged.jsonl",
      sessionId: "s-judged",
      mtimeMs: 123,
      score: 0.8,
      reasons: ["done"],
      judge: "openrouter/tencent/hy3:free",
      judgedAt: Date.now(),
      promptVersion: JUDGE_PROMPT_VERSION,
    });
    saveJudgment({
      file: "/tmp/old-prompt.jsonl",
      sessionId: "s-old",
      mtimeMs: 123,
      score: 0.2,
      reasons: ["old instrument"],
      judge: "codex/gpt-5.5",
      judgedAt: Date.now(),
      promptVersion: JUDGE_PROMPT_VERSION - 1,
    });
    recordJudgeFailure("/tmp/one-failure.jsonl", "transient");
    recordJudgeFailure("/tmp/capped.jsonl", "dead", { permanent: true });
    for (let i = 0; i < MAX_JUDGE_ATTEMPTS + 1; i++) recordJudgeFailure("/tmp/over-cap.jsonl", "dead");

    const skip = judgeSkipSet();
    assert.ok(skip.has("/tmp/judged.jsonl"), "judged file skipped");
    assert.ok(skip.has("/tmp/capped.jsonl"), "permanent failure skipped");
    assert.equal(skip.has("/tmp/over-cap.jsonl"), false, "repeated transient failures remain retryable");
    assert.equal(skip.has("/tmp/one-failure.jsonl"), false, "single transient failure is retried");
    assert.equal(skip.has("/tmp/old-prompt.jsonl"), false, "old prompt verdict is queued for re-judging");
    assert.equal(skip.size, 2);
    assert.equal(loadCurrentJudgments().size, 1);
  });
});
