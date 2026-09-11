import test from "node:test";
import assert from "node:assert/strict";
import { histogram, inRange, logDomain, parseChartSelection, sampleEvenly, selectionParams } from "../lib/chart-analysis";

test("chart selections roundtrip without consuming unrelated page filters", () => {
  const selection = { fromMs: 100, toMs: 1000, source: "codex", model: "org/model", metric: "tokens" as const, min: 1000, max: 10000 };
  const params = selectionParams(selection, new URLSearchParams("q=existing&section=models"));
  assert.equal(params.get("q"), "existing");
  assert.deepEqual(parseChartSelection(params), { selection });
  assert.equal(selectionParams({}, params).toString(), "q=existing&section=models");
});

test("invalid and ambiguous analytical selections fail closed", () => {
  for (const query of ["vizFrom=NaN", "vizFrom=50&vizTo=50", "vizFrom=-1", "vizHour=24", "vizWeekday=7", "vizMin=4", "vizMetric=duration&vizMin=5&vizMax=2", "vizMetric=cost", "vizOutcome=unknown", "vizSource=%00secret", "vizCostSource=missing"]) {
    assert.ok(parseChartSelection(new URLSearchParams(query)).error, query);
  }
});

test("sampling covers the entire chronological interval deterministically", () => {
  const points = Array.from({ length: 10000 }, (_, i) => i);
  const sampled = sampleEvenly(points, 400);
  assert.equal(sampled.length, 400);
  assert.equal(sampled[0], 0);
  assert.equal(sampled[399], 9999);
  assert.equal(new Set(sampled).size, 400);
  assert.deepEqual(sampled, sampleEvenly(points, 400));
  assert.deepEqual(sampleEvenly([], 400), []);
  assert.deepEqual(sampleEvenly([1], 400), [1]);
});

test("histogram bounds and drilldown conserve every finite nonnegative value", () => {
  const values = [0, 1, 999, 1000, 9999, 10000, 1e9, NaN, -1, Infinity];
  const result = histogram(values, "tokens");
  assert.equal(result.eligible, 7);
  assert.equal(result.missing, 3);
  assert.equal(result.bins.reduce((n, bin) => n + bin.count, 0), 7);
  for (const bin of result.bins) assert.equal(values.filter((v) => v >= 0 && inRange(v, bin.min, bin.max)).length, bin.count);
});

test("log domain includes extreme and singleton costs without clamping", () => {
  const domain = logDomain([1e-8, 1000000, 0, NaN, Infinity])!;
  assert.equal(domain.min, -8);
  assert.equal(domain.max, 6);
  assert.ok(domain.ticks.length <= 6);
  const one = logDomain([1])!;
  assert.ok(one.min < 0 && one.max > 0);
  assert.equal(logDomain([0, -1, NaN]), null);
});
