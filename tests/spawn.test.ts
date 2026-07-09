import test from "node:test";
import assert from "node:assert/strict";
import { appendCapped } from "../lib/runner/spawn";

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
