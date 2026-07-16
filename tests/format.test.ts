import test from "node:test";
import assert from "node:assert/strict";
import { fmtRel } from "../lib/format";

test("fmtRel uses an explicit reference time for deterministic server/client labels", () => {
  const now = Date.UTC(2026, 6, 16, 3, 0, 0);
  assert.equal(fmtRel(now - 59_000, now), "just now");
  assert.equal(fmtRel(now - 21 * 60_000, now), "21m ago");
  assert.equal(fmtRel(now - 22 * 3_600_000, now), "22h ago");
  assert.equal(fmtRel(now - 12 * 86_400_000, now), "12d ago");
});
