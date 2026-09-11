import test from "node:test";
import assert from "node:assert/strict";
import { POST, GET } from "../app/api/collection/timeline/judge/route";

test("invalid review scopes are rejected rather than silently broadened", async () => {
  for (const filters of [{ from: 20, to: 10 }, { from: "bad" }, { reasons: ["typo"] }, { limit: 51 }, { source: "" }]) {
    const response = await POST(new Request("http://localhost/api/collection/timeline/judge", { method: "POST", body: JSON.stringify({ preview: true, filters }) }));
    assert.equal(response.status, 400);
  }
  for (const query of ["from=bad", "limit=51", "reason=typo", "from=20&to=10"]) {
    const response = await GET(new Request(`http://localhost/api/collection/timeline/judge?preview=1&${query}`));
    assert.equal(response.status, 400);
  }
});
