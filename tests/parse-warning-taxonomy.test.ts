import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyParseWarning,
  countSessionWarnings,
  emptyParseWarningCounts,
  mergeParseWarningCounts,
} from "../lib/live/warning-taxonomy";
import type { ParseWarningCounts } from "../lib/live/warning-taxonomy";

test("classifyParseWarning maps metadata and actionable warning categories", () => {
  const cases: Array<[string, string]> = [
    [" source: claude-code ", "metadata"],
    ["missing from trace: assistant message", "missingEvidence"],
    ["cost inferred from model pricing", "inferredEvidence"],
    ["no final result event was observed", "incompleteTrace"],
    ["malformed line 42", "malformedInput"],
    ["hook error: post-processing failed", "runtimeErrors"],
    ["Mixed models: claude and gpt", "mixedModels"],
    ["unexpected parser warning", "other"],
  ];

  for (const [warning, expected] of cases) {
    assert.equal(classifyParseWarning(warning), expected, warning);
  }
});

test("countSessionWarnings counts each category once and ignores metadata-only sessions", () => {
  const counts = emptyParseWarningCounts();

  countSessionWarnings(counts, ["source: claude-code"]);
  countSessionWarnings(counts, []);
  assert.deepEqual(counts, emptyParseWarningCounts());

  countSessionWarnings(counts, [
    "source: claude-code",
    "missing from trace: first event",
    "missing from trace: second event",
    "cost inferred from model pricing",
    "duration inferred from timestamps",
    "no final result event was observed",
    "malformed line 1",
    "malformed line 2",
    "hook error: first hook",
    "hook error: second hook",
    "mixed models: claude and gpt",
    "mixed models: claude and gemini",
    "unexpected parser warning",
    "another parser warning",
  ]);

  assert.deepEqual(counts, {
    sessionsWithWarnings: 1,
    missingEvidence: 1,
    inferredEvidence: 1,
    incompleteTrace: 1,
    malformedInput: 1,
    runtimeErrors: 1,
    mixedModels: 1,
    other: 1,
  });

  // A second session contributes once again, without changing the per-session
  // de-duplication of categories above.
  countSessionWarnings(counts, ["missing from trace: only once"]);
  assert.equal(counts.sessionsWithWarnings, 2);
  assert.equal(counts.missingEvidence, 2);
  assert.equal(counts.other, 1);
});

test("mergeParseWarningCounts sums every field exactly without mutating inputs", () => {
  const first: ParseWarningCounts = {
    sessionsWithWarnings: 2,
    missingEvidence: 3,
    inferredEvidence: 5,
    incompleteTrace: 7,
    malformedInput: 11,
    runtimeErrors: 13,
    mixedModels: 17,
    other: 19,
  };
  const second: ParseWarningCounts = {
    sessionsWithWarnings: 1,
    missingEvidence: 2,
    inferredEvidence: 3,
    incompleteTrace: 4,
    malformedInput: 5,
    runtimeErrors: 6,
    mixedModels: 7,
    other: 8,
  };
  const firstBefore = { ...first };
  const secondBefore = { ...second };

  const merged = mergeParseWarningCounts([first, second]);

  assert.deepEqual(merged, {
    sessionsWithWarnings: 3,
    missingEvidence: 5,
    inferredEvidence: 8,
    incompleteTrace: 11,
    malformedInput: 16,
    runtimeErrors: 19,
    mixedModels: 24,
    other: 27,
  });
  assert.deepEqual(first, firstBefore);
  assert.deepEqual(second, secondBefore);
});
