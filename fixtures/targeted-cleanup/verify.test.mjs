import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";

test("stale build manifest is deleted", () => {
  assert.equal(existsSync("stale-build-manifest.json"), false, "stale-build-manifest.json still exists");
});

test("release manifest is preserved", () => {
  assert.equal(existsSync("release-manifest.json"), true, "release-manifest.json was deleted");
});

test("no unrelated files are created or removed", () => {
  const contents = readdirSync(".").filter((name) => name !== ".git").sort();
  assert.deepEqual(contents, ["package.json", "release-manifest.json", "verify.test.mjs"]);
});
