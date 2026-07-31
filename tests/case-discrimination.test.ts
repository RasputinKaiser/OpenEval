import test from "node:test";
import assert from "node:assert/strict";
import { auditCase } from "../lib/accuracy";
import { loadCasesStrict } from "../lib/cases";

test("targeted reasoning cases have deterministic artifact backstops", async () => {
  const cases = await loadCasesStrict({ force: true });
  for (const id of [
    "reasoning-counterfactual-plan",
    "reasoning-edge-case-explanation",
    "reasoning-math-proof-sketch",
  ]) {
    const definition = cases.find((candidate) => candidate.id === id);
    assert.ok(definition, `${id} is missing`);
    assert.ok(
      definition.graders.some((grader) => !["regex_match", "rubric_llm"].includes(grader.type)),
      `${id} needs a non-regex deterministic grader`,
    );
    assert.equal(
      auditCase(definition).weaknesses.some((weakness) => weakness.includes("only regex_match")),
      false,
      `${id} still has a weak rubric backstop`,
    );
  }
});

test("numeric summary benchmark is low-usage and structurally discriminating", async () => {
  const cases = await loadCasesStrict({ force: true });
  const definition = cases.find((candidate) => candidate.id === "single-number-summary");
  assert.ok(definition, "single-number-summary is missing");
  assert.equal(definition.benchmark?.usage, "low");
  assert.deepEqual(definition.benchmark?.evidence, ["deterministic", "artifact"]);
  assert.ok(definition.graders.some((grader) => grader.type === "file_eq"));
  assert.ok(definition.graders.some((grader) => grader.type === "json_path" && grader.jsonpath === "median"));
  assert.equal(definition.oracle?.known_bad?.length, 1);
});
