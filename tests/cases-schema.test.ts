import test from "node:test";
import assert from "node:assert/strict";
import { CaseDefinitionSchema, loadCasesWithErrors, loadCasesStrict, CASE_CATEGORIES } from "../lib/cases";

const validCase = {
  id: "schema-test-case",
  category: "single-tool",
  name: "Schema test",
  prompt: "Do the thing.",
  graders: [{ type: "file_exists", path: "out.txt" }],
};

test("a minimal well-formed case parses", () => {
  const r = CaseDefinitionSchema.safeParse(validCase);
  assert.ok(r.success, JSON.stringify(!r.success && r.error.issues));
});

test("strict schema rejects an unknown top-level key", () => {
  const r = CaseDefinitionSchema.safeParse({ ...validCase, tiemout_seconds: 60 });
  assert.equal(r.success, false);
});

test("strict schema rejects an unknown grader key (a typo must not silently weaken grading)", () => {
  const r = CaseDefinitionSchema.safeParse({
    ...validCase,
    graders: [{ type: "file_contains", path: "out.txt", pattren: "done" }],
  });
  assert.equal(r.success, false);
});

test("strict schema rejects unknown keys in nested runner/budget/setup blocks", () => {
  assert.equal(CaseDefinitionSchema.safeParse({ ...validCase, runner: { max_trns: 5 } }).success, false);
  assert.equal(CaseDefinitionSchema.safeParse({ ...validCase, budget: { max_cost: 1 } }).success, false);
  assert.equal(CaseDefinitionSchema.safeParse({ ...validCase, setup: { type: "fixture", fixure: "x" } }).success, false);
});

test("strict schema rejects a git-clone setup without a repo", () => {
  assert.equal(CaseDefinitionSchema.safeParse({ ...validCase, setup: { type: "git-clone" } }).success, false);
});

test("strict schema rejects an empty grader list and unknown grader types", () => {
  assert.equal(CaseDefinitionSchema.safeParse({ ...validCase, graders: [] }).success, false);
  assert.equal(CaseDefinitionSchema.safeParse({ ...validCase, graders: [{ type: "vibes" }] }).success, false);
});

// Regression net: every case shipped in cases/ must load through the real
// strict loader. A future typo in any .case.json fails here, not at run time.
test("every shipped case loads via loadCasesStrict with zero validation errors", async () => {
  const { cases, errors } = await loadCasesWithErrors({ force: true });
  assert.deepEqual(errors, [], `case files with validation errors: ${JSON.stringify(errors)}`);
  assert.ok(cases.length > 0, "expected the repo's shipped cases to be found (run tests from the repo root)");

  const strict = await loadCasesStrict({ force: true });
  assert.equal(strict.length, cases.length);

  const ids = strict.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "case ids must be unique");
  for (const c of strict) {
    assert.ok((CASE_CATEGORIES as readonly string[]).includes(c.category), `${c.id}: unknown category ${c.category}`);
    assert.ok(c.graders.length >= 1, `${c.id}: no graders`);
  }
});
