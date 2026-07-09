import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveWithin } from "../lib/config";
import { safeParse } from "../lib/db";

// ---- resolveWithin (artifact path safety) ----

test("resolveWithin allows plain and nested subpaths", () => {
  const base = "/srv/workdir";
  assert.equal(resolveWithin(base, "file.txt"), path.join(base, "file.txt"));
  assert.equal(resolveWithin(base, "dist/index.html"), path.join(base, "dist/index.html"));
  assert.equal(resolveWithin(base, "./a/b/c.css"), path.join(base, "a/b/c.css"));
});

test("resolveWithin blocks traversal and absolute escapes", () => {
  const base = "/srv/workdir";
  assert.equal(resolveWithin(base, "../secret.txt"), null);
  assert.equal(resolveWithin(base, "a/../../secret.txt"), null);
  assert.equal(resolveWithin(base, "/etc/passwd"), null);
  // the base itself is not a servable artifact
  assert.equal(resolveWithin(base, "."), null);
});

test("resolveWithin is not fooled by a sibling dir sharing a name prefix", () => {
  // A naive `startsWith(base)` check would accept `/srv/workdir-evil/...`.
  assert.equal(resolveWithin("/srv/workdir", "../workdir-evil/x"), null);
});

// ---- safeParse (DB read resilience) ----

test("safeParse returns parsed value for valid JSON", () => {
  assert.deepEqual(safeParse('{"a":1}', {}), { a: 1 });
  assert.deepEqual(safeParse("[1,2,3]", []), [1, 2, 3]);
});

test("safeParse falls back on null, undefined, and corrupt JSON", () => {
  const fallback = { runner: "headless", parallel: 1 };
  assert.equal(safeParse(null, fallback), fallback);
  assert.equal(safeParse(undefined, fallback), fallback);
  assert.equal(safeParse("{truncated", fallback), fallback);
  assert.equal(safeParse("", fallback), fallback);
});
