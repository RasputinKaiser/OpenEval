import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

test("stale build manifest is deleted", () => {
  assert.equal(existsSync("stale-build-manifest.json"), false, "stale-build-manifest.json still exists");
});

test("release manifest is preserved", () => {
  assert.equal(existsSync("release-manifest.json"), true, "release-manifest.json was deleted");
});
