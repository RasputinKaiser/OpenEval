import test from "node:test";
import assert from "node:assert/strict";
import { appendCapped, drainLineBuffer } from "../lib/runner/spawn";
import { parseCodexLine } from "../lib/adapters/codex";
import type { ParseAccumulator } from "../lib/adapters/types";

test("appendCapped concatenates below the cap", () => {
  assert.equal(appendCapped("", "abc"), "abc");
  assert.equal(appendCapped("abc", "def", 100), "abcdef");
});

test("appendCapped truncates once at the cap and then stops growing", () => {
  const cap = 10;
  const first = appendCapped("012345678", "extra", cap); // len 9 + 5 crosses the cap
  assert.ok(first.startsWith("012345678"));
  assert.ok(first.includes("truncated"));
  // subsequent appends do not grow it further
  const second = appendCapped(first, "more and more output", cap);
  assert.equal(second, first);
});

test("appendCapped adds the marker exactly at the boundary crossing", () => {
  const cap = 5;
  const out = appendCapped("abc", "defgh", cap); // "abcdefgh" length 8 > 5
  assert.equal(out, "abcde\n…[output truncated]…");
});

test("appendCapped stops growing once the cap is reached", () => {
  const cap = 5;
  const full = appendCapped("", "abcde", cap); // exactly at cap, no truncation yet
  assert.equal(full, "abcde");
  // further content never grows the string past the cap
  assert.equal(appendCapped(full, "x", cap), "abcde");
  assert.ok(appendCapped(full, "x", cap).length <= cap);
});

test("drainLineBuffer emits complete lines and keeps the trailing fragment", () => {
  const lines: string[] = [];
  const rest = drainLineBuffer("a\nb\npartial", (l) => lines.push(l));
  assert.deepEqual(lines, ["a", "b"]);
  assert.equal(rest, "partial");
});

test("drainLineBuffer keeps a fragment at or below the cap", () => {
  const lines: string[] = [];
  const rest = drainLineBuffer("abc", (l) => lines.push(l), 10);
  assert.deepEqual(lines, []);
  assert.equal(rest, "abc");
});

test("drainLineBuffer flushes and resets an oversized newline-less fragment", () => {
  const lines: string[] = [];
  const rest = drainLineBuffer("x".repeat(20), (l) => lines.push(l), 10);
  assert.deepEqual(lines, ["x".repeat(20)]);
  assert.equal(rest, "");
  // subsequent chunks start from an empty buffer instead of growing forever
  const more: string[] = [];
  assert.equal(drainLineBuffer(rest + "y".repeat(11), (l) => more.push(l), 10), "");
  assert.deepEqual(more, ["y".repeat(11)]);
});

test("Codex failure diagnostics stay out of finalText", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({ type: "turn.failed", error: { message: "SECRET_DIAGNOSTIC" } }), acc);
  assert.equal(acc.result?.isError, true);
  assert.equal(acc.result?.finalText, "");
  assert.equal(acc.result?.resultText, "SECRET_DIAGNOSTIC");
});
