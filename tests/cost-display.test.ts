import assert from "node:assert/strict";
import test from "node:test";
import { presentRunnerCost, presentSummaryCost } from "../lib/cost-display";

test("presentRunnerCost distinguishes measured, inferred, and missing", () => {
  assert.deepEqual(presentRunnerCost({ costUsd: 1.25, costSource: "measured" }), { label: "Cost", value: "$1.2500", available: true });
  assert.deepEqual(presentRunnerCost({ costUsd: 1.25, costSource: "inferred" }), { label: "Est. cost", value: "~$1.2500", available: true });
  assert.deepEqual(presentRunnerCost({ costUsd: 99, costSource: "missing" }), { label: "Cost", value: "missing", available: false });
  assert.deepEqual(presentRunnerCost({ costUsd: 99 }), { label: "Cost", value: "missing", available: false });
});

test("presentSummaryCost exposes partial and fully missing coverage", () => {
  assert.deepEqual(
    presentSummaryCost({ totalCostUsd: 1.25, estimatedCostCases: 1, measuredCostCases: 1, missingCostCases: 1 }),
    { label: "Partial est. cost", value: "~$1.2500 + 1 missing", available: true },
  );
  assert.deepEqual(
    presentSummaryCost({ totalCostUsd: 0, estimatedCostCases: 0, measuredCostCases: 0, missingCostCases: 2 }),
    { label: "Total cost", value: "missing (2 cases)", available: false },
  );
  assert.deepEqual(
    presentSummaryCost({ totalCostUsd: 2.5 }),
    { label: "Unverified legacy cost", value: "$2.5000 (source unknown)", available: true },
  );
});
