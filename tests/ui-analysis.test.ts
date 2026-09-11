import test from "node:test";
import assert from "node:assert/strict";
import { numericBins, numericSummary, groupedCounts } from "../lib/ui-analysis";

test("distribution summaries retain zero and separate missing/nonfinite values", () => {
  assert.deepEqual(numericSummary([0, 10, 20, null, undefined, NaN, Infinity, -1]), { count: 3, missing: 5, min: 0, median: 10, p90: 18, max: 20 });
  assert.equal(numericSummary([]).median, null);
  assert.deepEqual(numericBins([0, 0, null]), [{ min: 0, max: 0, count: 2, final: true }]);
});
test("bins conserve finite data at boundaries and group counts retain identities", () => {
  const bins = numericBins([0, 1, 2, 3, 4, 5, null], 5);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 6);
  assert.equal(bins.at(-1)?.count, 2);
  assert.deepEqual(groupedCounts(["b", "a", "b"], v => v), [{ label: "b", count: 2 }, { label: "a", count: 1 }]);
});
