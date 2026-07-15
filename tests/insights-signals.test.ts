import test from "node:test";
import assert from "node:assert/strict";
import { classifySentiment, isRephrase, looksLikeApologyOrFailure, looksLikeTestsPassed, mcpServerFromTool } from "../lib/insights/signals";

test("classifySentiment: positive, negative, neutral; negative wins ties", () => {
  assert.equal(classifySentiment("thanks, that works great"), "positive");
  assert.equal(classifySentiment("perfect"), "positive");
  assert.equal(classifySentiment("no, that's wrong"), "negative");
  assert.equal(classifySentiment("still broken"), "negative");
  assert.equal(classifySentiment("please revert that"), "negative");
  assert.equal(classifySentiment("thanks but that's not what I wanted"), "negative"); // correction, not praise
  assert.equal(classifySentiment("now add a button here"), "neutral");
  assert.equal(classifySentiment(""), "neutral");
});

test("classifySentiment: word boundaries avoid false hits", () => {
  assert.equal(classifySentiment("there is nothing to do"), "neutral"); // not "no"
  assert.equal(classifySentiment("the notebook is fine"), "neutral");
});

test("classifySentiment: neutral grammar does not fire as a verdict", () => {
  // Determiner "no" is not a rejection.
  assert.equal(classifySentiment("no rush, take your time"), "neutral");
  assert.equal(classifySentiment("make sure there are no regressions"), "neutral");
  assert.equal(classifySentiment("no errors now, thanks!"), "positive"); // praise, not correction
  // Bare "works"/"correct" are descriptions, not approval.
  assert.equal(classifySentiment("explain how the login works"), "neutral");
  assert.equal(classifySentiment("the correct behavior should be X"), "neutral");
  // Evaluative forms still fire.
  assert.equal(classifySentiment("No, that's wrong"), "negative");
  assert.equal(classifySentiment("that works"), "positive");
  assert.equal(classifySentiment("that's correct"), "positive");
});

test("classifySentiment: short rejection replies remain negative", () => {
  assert.equal(classifySentiment("no"), "negative");
  assert.equal(classifySentiment("no thanks"), "negative");
  assert.equal(classifySentiment("no rush, take your time"), "neutral");
});

test("isRephrase: lead-ins and high overlap", () => {
  assert.equal(isRephrase("actually, make it blue", null), true);
  assert.equal(isRephrase("no, I meant the header", null), true);
  assert.equal(
    isRephrase("add a login button to the header", "add a login button on the header please"),
    true,
  );
  assert.equal(isRephrase("now write the tests", "add a login button to the header"), false);
  assert.equal(isRephrase("", "anything"), false);
});

test("looksLikeApologyOrFailure", () => {
  assert.equal(looksLikeApologyOrFailure("Sorry, I was unable to fix that."), true);
  assert.equal(looksLikeApologyOrFailure("I couldn't reproduce the bug"), true);
  assert.equal(looksLikeApologyOrFailure("Done — the fix is applied and tests pass."), false);
});

test("looksLikeTestsPassed", () => {
  assert.equal(looksLikeTestsPassed("All tests passed"), true);
  assert.equal(looksLikeTestsPassed("12 passing"), true);
  assert.equal(looksLikeTestsPassed("Build succeeded in 3.2s"), true);
  assert.equal(looksLikeTestsPassed("build successful"), true);
  assert.equal(looksLikeTestsPassed("✓ all good"), true);
  assert.equal(looksLikeTestsPassed("tests: ✔"), true);
  assert.equal(looksLikeTestsPassed("here is the code"), false);
});

test("mcpServerFromTool extracts the server segment", () => {
  assert.equal(mcpServerFromTool("mcp__spokenly__ask_user_dictation"), "spokenly");
  assert.equal(mcpServerFromTool("mcp__Control_Chrome__open_url"), "Control_Chrome");
  assert.equal(mcpServerFromTool("Bash"), null);
  assert.equal(mcpServerFromTool(undefined), null);
});
