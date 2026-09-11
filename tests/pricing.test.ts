// Pin the compiled-tier assertions: never let a developer-machine snapshot
// (data/openrouter-pricing.json) change which tier answers these lookups.
process.env.OPENEVAL_DISABLE_PRICING_SNAPSHOT = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { displayModelId, estimateCostUsd, rateForModel, rateForModelInfo, pricingProvenanceDate, PRICING_LIST_DATE, DEFAULT_RATE } from "../lib/pricing";

test("rateForModel returns OpenRouter-sourced rates for known models", () => {
  assert.equal(rateForModel("claude-opus-4-8")?.output, 25);
  assert.equal(rateForModel("claude-sonnet-5")?.input, 2);
  assert.equal(rateForModel("claude-sonnet-4-6")?.input, 3);
  assert.equal(rateForModel("claude-fable-5")?.output, 50);
  assert.equal(rateForModel("claude-haiku-4-5")?.input, 1);
  assert.equal(rateForModel("gpt-5.5")?.output, 30);
  assert.deepEqual(rateForModel("gpt-5.6-luna"), { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0.125 });
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
  assert.deepEqual(rateForModel("gpt-5.6-luna"), { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0.125 });
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

test("OpenRouter catalog rates resolve before the compiled list, including $0 free tiers", async () => {
  const catalog = await import("../lib/pricing-catalog");
  // $0 free tier: a real list price, so a listed-rate estimate at $0.
  catalog.setOpenRouterCatalogForTests([
    { id: "acme/tiny-free:free", pricing: { prompt: 0, completion: 0, input_cache_read: 0, input_cache_write: 0 } },
    { id: "acme/tiny", pricing: { prompt: 0.0000002, completion: 0.00000115, input_cache_read: 0.00000002, input_cache_write: 0.0000002 } },
    { id: "vendor/leafmatch", pricing: { prompt: 0.000000132, completion: 0.000000528 } },
    { id: "acme/sentinel-router", pricing: { prompt: -1, completion: -1 } },
  ]);
  try {
    const free = rateForModelInfo("acme/tiny-free:free");
    assert.equal(free?.confidence, "listed");
    assert.equal(free?.exact, true);
    assert.deepEqual(free?.rate, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    // Free-tier estimate at real usage is exactly $0, not null.
    assert.equal(estimateCostUsd("acme/tiny-free:free", { input: 1_000_000, output: 500_000 }), 0);

    // :free suffix strips to the paid base rate.
    const paidViaFree = rateForModelInfo("acme/tiny:free");
    assert.equal(paidViaFree?.confidence, "listed");
    // 0.2e-6 * 1e6 crosses binary-float representation; compare with epsilon.
    assert.ok(Math.abs((paidViaFree?.rate.input ?? 0) - 0.2) < 1e-12);
    assert.ok(Math.abs((paidViaFree?.rate.output ?? 0) - 1.15) < 1e-12);

    // hf: prefix strips before lookup.
    assert.equal(rateForModelInfo("hf:acme/tiny")?.confidence, "listed");

    // Bare leaf matches vendor/<leaf> when unambiguous.
    const leaf = rateForModelInfo("leafmatch");
    assert.equal(leaf?.confidence, "listed");
    assert.equal(leaf?.sourceModel, "vendor/leafmatch");

    // Negative sentinel rates (openrouter/auto-style dynamic pricing) are
    // rejected at parse time — pricing with them produced a -$1.2M estimate.
    assert.equal(rateForModelInfo("acme/sentinel-router")?.confidence, "fallback");

    // Unknown ids still fall back honestly.
    assert.equal(rateForModelInfo("totally-unknown-model")?.confidence, "fallback");
  } finally {
    catalog.clearOpenRouterCatalogForTests();
  }
});

test("catalog hit beats the compiled list when both define an id", async () => {
  const catalog = await import("../lib/pricing-catalog");
  catalog.setOpenRouterCatalogForTests([
    { id: "openai/gpt-5.5", pricing: { prompt: 0.0000042, completion: 0.000021 } },
  ]);
  try {
    const info = rateForModelInfo("gpt-5.5");
    assert.equal(info?.confidence, "listed");
    assert.equal(info?.sourceModel, "openai/gpt-5.5");
    // 4.2/M and 21/M from the live catalog, not the compiled 5/30.
    assert.ok(Math.abs((info?.rate.input ?? 0) - 4.2) < 1e-12);
    assert.ok(Math.abs((info?.rate.output ?? 0) - 21) < 1e-12);
  } finally {
    catalog.clearOpenRouterCatalogForTests();
  }
});

test("pricingProvenanceDate prefers a live snapshot newer than the compiled list", async () => {
  const catalog = await import("../lib/pricing-catalog");
  // No snapshot: compiled date.
  assert.equal(pricingProvenanceDate(), PRICING_LIST_DATE);
  // Newer snapshot: snapshot date wins.
  catalog.setOpenRouterCatalogForTests([{ id: "x/y", pricing: { prompt: 0.1, completion: 0.2 } }]);
  // test-seed source is not a snapshot/network fetch, so it must NOT claim freshness.
  assert.equal(pricingProvenanceDate(), PRICING_LIST_DATE);
  catalog.clearOpenRouterCatalogForTests();
});
