import test from "node:test";
import assert from "node:assert/strict";
import { comparisonDelta, comparisonKey, transitionCounts, type ComparisonValues } from "../lib/comparison-analysis";
const row: ComparisonValues = { caseId: "case::name", caseName: "Example", sample: 0, aStatus: "passed", bStatus: "failed", aCost: 0, bCost: 0.00001, aTokPerSec: null, bTokPerSec: 10, aTurns: 2, bTurns: 1 };
test("transitions conserve sample identities and retain unmatched cases", () => {
 const rows = [row, { ...row, sample: 1, bStatus: "passed" }, { ...row, caseId: "other", aStatus: null }];
 const cells = transitionCounts(rows);
 assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), 3);
 assert.equal(cells.find((cell) => cell.from === null)?.count, 1);
 assert.notEqual(comparisonKey(rows[0]), comparisonKey(rows[1]));
});
test("metric deltas retain true zero and omit unavailable or nonfinite values", () => {
 assert.equal(comparisonDelta(row, "cost"), 0.00001);
 assert.equal(comparisonDelta(row, "rate"), null);
 assert.equal(comparisonDelta(row, "turns"), -1);
 assert.equal(comparisonDelta({ ...row, aCost: Infinity }, "cost"), null);
});
