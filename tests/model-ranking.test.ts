import test from "node:test";
import assert from "node:assert/strict";
import { modelBarFraction, modelMeasure } from "../lib/model-ranking";
const a = { sessions: 2, inputTokens: 10, outputTokens: 10, cacheReadTokens: 80, toolCalls: 10, toolErrors: 2, costUsd: 9 };
const b = { sessions: 8, inputTokens: 60, outputTokens: 20, cacheReadTokens: 20, toolCalls: 90, toolErrors: 3, costUsd: 1 };
test("model bars follow each selected metric against the full population", () => {
  for (const metric of ["cost", "sessions", "tokens", "cache", "tools"] as const) assert.equal(modelBarFraction(a, [a,b], metric) + modelBarFraction(b, [a,b], metric), 1);
  assert.equal(modelBarFraction(a, [a,b], "cost"), .9);
  assert.equal(modelBarFraction(a, [a,b], "sessions"), .2);
  assert.equal(modelBarFraction(a, [a,b], "tokens"), .2);
  assert.equal(modelBarFraction(a, [a,b], "cache"), .8);
  assert.equal(modelBarFraction(a, [a,b], "tools"), .1);
});
test("error bars express a per-model rate rather than a share of summed rates", () => {
  assert.equal(modelBarFraction(a, [a,b], "errors"), .2);
  assert.equal(modelBarFraction(b, [a,b], "errors"), 3/90);
  assert.equal(modelMeasure({ ...a, toolCalls: 0 }, "errors"), 0);
  assert.equal(modelBarFraction({ ...a, costUsd: 0 }, [], "cost"), 0);
});
