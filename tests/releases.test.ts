import test from "node:test";
import assert from "node:assert/strict";
import { isNewerRelease, readRelease, stableVersion } from "../lib/releases";

test("release comparison uses numeric stable versions, including multi-digit patches", () => {
  assert.equal(isNewerRelease("v0.1.10", "0.1.9"), true);
  assert.equal(isNewerRelease("v0.2.0", "0.1.99"), true);
  assert.equal(isNewerRelease("v0.1.6", "0.2.0"), false);
  assert.equal(isNewerRelease("v0.2.0", "0.2.0"), false);
  for (const value of ["v1.0.0-rc.1", "v1.2.3;echo unsafe", "../main", "v99999999999999999.0.0"]) assert.equal(stableVersion(value), null);
});
test("release metadata only accepts stable releases and constructs trusted links", () => {
  const valid = { tag_name: "v0.2.0", draft: false, prerelease: false, html_url: "https://untrusted.invalid" };
  assert.deepEqual(readRelease(valid, "0.1.6"), { installed: "0.1.6", latest: "v0.2.0", available: true, url: "https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.2.0" });
  for (const value of [null, { ...valid, draft: true }, { ...valid, prerelease: true }, { ...valid, tag_name: "main" }]) assert.throws(() => readRelease(value, "0.1.6"));
});
