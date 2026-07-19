import test from "node:test";
import assert from "node:assert/strict";
import { displayModelId, estimateCostUsd, rateForModel, rateForModelInfo, DEFAULT_RATE } from "../lib/pricing";

test("rateForModel returns OpenRouter-sourced rates for known models", () => {
  assert.equal(rateForModel("claude-opus-4-8")?.output, 25);
  assert.equal(rateForModel("claude-sonnet-5")?.input, 2);
  assert.equal(rateForModel("claude-sonnet-4-6")?.input, 3);
  assert.equal(rateForModel("claude-fable-5")?.output, 50);
  assert.equal(rateForModel("claude-haiku-4-5")?.input, 1);
  assert.equal(rateForModel("gpt-5.5")?.output, 30);
  assert.equal(rateForModel("gpt-5-codex")?.input, 1.25);
  assert.equal(rateForModel("z-ai/glm-5.2")?.input, 0.952);
  assert.equal(rateForModel("/data/models/hf/zai-org__GLM-5.2-FP8")?.input, 0.952);
  assert.equal(rateForModel("deepseek-ai/deepseek-v4-pro")?.output, 0.87);
});

test("rateForModelInfo falls back to DEFAULT for unknown named models, null for empty", () => {
  const unknown = rateForModelInfo("some-unknown-model");
  assert.equal(unknown?.exact, false);
  assert.deepEqual(unknown?.rate, DEFAULT_RATE);
  assert.equal(rateForModelInfo("<synthetic>"), null);
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

test("pricing resolves the listed model instead of a broad GPT or Claude family guess", () => {
  assert.deepEqual(rateForModel("gpt-5.4"), { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 });
  assert.deepEqual(rateForModel("gpt-5.4-mini"), { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 });
  assert.deepEqual(rateForModel("gpt-5-codex"), { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 });
  assert.deepEqual(rateForModel("gpt-5.6-luna"), { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 });
  assert.deepEqual(rateForModel("gpt-5.6-terra"), { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 });
  assert.deepEqual(rateForModel("claude-sonnet-4-6"), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  assert.deepEqual(rateForModel("z-ai/glm-5.2"), { input: 0.952, output: 2.992, cacheRead: 0.1768, cacheWrite: 0.952 });
  assert.equal(estimateCostUsd("gpt-5.4", { input: 1_000_000, output: 1_000_000 }), 17.5);
});

test("pricing reports listed, family-mapped, and fallback rate provenance", () => {
  const listed = rateForModelInfo("gpt-5.4");
  assert.equal(listed?.confidence, "listed");
  assert.equal(listed?.sourceModel, "openai/gpt-5.4");

  const family = rateForModelInfo("/data/models/hf/zai-org__GLM-5.2-FP8");
  assert.equal(family?.confidence, "family");
  assert.equal(family?.sourceModel, "z-ai/glm-5.2");

  const fallback = rateForModelInfo("some-unknown-model");
  assert.equal(fallback?.confidence, "fallback");
  assert.equal(fallback?.exact, false);
});

test("memoized repeat lookups return identical results", () => {
  const first = rateForModelInfo("claude-opus-4-8");
  const second = rateForModelInfo("claude-opus-4-8");
  assert.deepEqual(second, first);
  assert.deepEqual(second, {
    rate: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    exact: true,
    confidence: "listed",
    sourceModel: "anthropic/claude-opus-4.8",
  });

  const familyFirst = rateForModelInfo("/data/models/hf/zai-org__GLM-5.2-FP8");
  assert.deepEqual(rateForModelInfo("/data/models/hf/zai-org__GLM-5.2-FP8"), familyFirst);
  assert.equal(familyFirst?.confidence, "family");

  // Unknown-model fallback is unchanged and stable across repeat lookups.
  const unknownFirst = rateForModelInfo("some-unknown-model");
  const unknownSecond = rateForModelInfo("some-unknown-model");
  assert.deepEqual(unknownSecond, unknownFirst);
  assert.deepEqual(unknownSecond?.rate, DEFAULT_RATE);
  assert.equal(unknownSecond?.confidence, "fallback");

  // Placeholder/null inputs stay unpriced on repeat calls too.
  assert.equal(rateForModelInfo("<synthetic>"), null);
  assert.equal(rateForModelInfo("<synthetic>"), null);
  assert.equal(rateForModelInfo(null), null);
});

test("displayModelId removes host-specific model paths without inventing a different model", () => {
  assert.equal(displayModelId("/data/models/hf/zai-org__GLM-5.2-FP8"), "hf:zai-org/glm-5.2-fp8");
  assert.equal(displayModelId("gpt-5.6-luna"), "gpt-5.6-luna");
});
