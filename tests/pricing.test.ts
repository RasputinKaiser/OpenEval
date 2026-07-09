import test from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd, rateForModel, rateForModelInfo, DEFAULT_RATE } from "../lib/pricing";

test("rateForModel returns OpenRouter-sourced rates for known families", () => {
  assert.equal(rateForModel("claude-opus-4-8")?.output, 25);
  assert.equal(rateForModel("claude-sonnet-5")?.input, 2);
  assert.equal(rateForModel("claude-sonnet-4-6")?.input, 2);
  assert.equal(rateForModel("claude-fable-5")?.output, 50);
  assert.equal(rateForModel("claude-haiku-4-5")?.input, 0.8);
  assert.equal(rateForModel("gpt-5.5")?.output, 30);
  assert.equal(rateForModel("gpt-5-codex")?.input, 5);
  assert.equal(rateForModel("z-ai/glm-5.2")?.input, 0.9);
  assert.equal(rateForModel("/data/models/hf/zai-org__GLM-5.2-FP8")?.input, 0.9);
  assert.equal(rateForModel("deepseek-ai/deepseek-v4-pro")?.output, 0.87);
});

test("rateForModelInfo falls back to DEFAULT for unknown named models, null for empty", () => {
  const unknown = rateForModelInfo("<synthetic>");
  assert.equal(unknown?.exact, false);
  assert.deepEqual(unknown?.rate, DEFAULT_RATE);
  assert.equal(rateForModelInfo("claude-opus-4-8")?.exact, true);
  assert.equal(rateForModelInfo(null), null);
  assert.equal(rateForModelInfo("  "), null);
});

test("estimateCostUsd applies per-token-class rates (OpenRouter Opus 5/25)", () => {
  // 100k input @5 + 50k output @25 = 0.5 + 1.25 = 1.75
  assert.equal(estimateCostUsd("claude-opus-4-8", { input: 100_000, output: 50_000 }), 1.75);
  // 1M cacheRead @0.5 + 1M cacheWrite @6.25 = 0.5 + 6.25
  assert.equal(
    estimateCostUsd("claude-opus-4-8", { input: 0, output: 0, cacheRead: 1_000_000, cacheCreate: 1_000_000 }),
    6.75,
  );
});

test("estimateCostUsd guesstimates unknown models rather than returning $0", () => {
  // unknown model → DEFAULT_RATE (1/3), 1M input + 1M output = 1 + 3 = 4
  assert.equal(estimateCostUsd("some-unknown-model", { input: 1_000_000, output: 1_000_000 }), 4);
  // but a null/empty model can't be guessed
  assert.equal(estimateCostUsd(null, { input: 100, output: 100 }), null);
  assert.equal(estimateCostUsd("gpt-5.5", { input: 0, output: 0 }), null);
});

test("estimateCostUsd never returns a negative cost", () => {
  const c = estimateCostUsd("gpt-5.5", { input: -100, output: 50_000 });
  assert.ok(c !== null && c >= 0);
});
