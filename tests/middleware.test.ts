import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function req(method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/runs", { method, headers: { host: "localhost:3000", ...headers } });
}

test("cross-site POST (Sec-Fetch-Site: cross-site) is rejected with 403", async () => {
  const res = middleware(req("POST", { "sec-fetch-site": "cross-site" }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "cross-site request rejected" });
});

test("same-site POST is rejected — only same-origin and none pass", async () => {
  const res = middleware(req("POST", { "sec-fetch-site": "same-site" }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "cross-site request rejected" });
});

test("same-origin POST passes", () => {
  const res = middleware(req("POST", { "sec-fetch-site": "same-origin" }));
  assert.equal(res.status, 200);
});

test("direct-navigation POST (Sec-Fetch-Site: none) passes", () => {
  const res = middleware(req("POST", { "sec-fetch-site": "none" }));
  assert.equal(res.status, 200);
});

test("curl-style POST with no browser headers passes", () => {
  const res = middleware(req("POST"));
  assert.equal(res.status, 200);
});

test("GET always passes, even cross-site", () => {
  assert.equal(middleware(req("GET")).status, 200);
  assert.equal(middleware(req("GET", { "sec-fetch-site": "cross-site", origin: "http://evil.example" })).status, 200);
});

test("Origin host mismatch without Sec-Fetch-Site is rejected with 403", async () => {
  const res = middleware(req("POST", { origin: "http://evil.example", host: "localhost:3000" }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "cross-origin request rejected" });
});

test("matching Origin/Host without Sec-Fetch-Site passes", () => {
  const res = middleware(req("POST", { origin: "http://localhost:3000", host: "localhost:3000" }));
  assert.equal(res.status, 200);
});

test("unparseable Origin is rejected", async () => {
  const res = middleware(req("POST", { origin: "not-a-url", host: "localhost:3000" }));
  assert.equal(res.status, 403);
});

test("Sec-Fetch-Site wins over a matching Origin", async () => {
  const res = middleware(req("DELETE", {
    "sec-fetch-site": "cross-site",
    origin: "http://localhost:3000",
    host: "localhost:3000",
  }));
  assert.equal(res.status, 403);
});

test("DNS-rebound host is rejected even when browser headers say same-origin", async () => {
  const res = middleware(req("POST", {
    host: "attacker.example:3000",
    origin: "http://attacker.example:3000",
    "sec-fetch-site": "same-origin",
  }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "host not allowed" });
});

test("configured non-local host is allowed explicitly", () => {
  const previous = process.env.OPENEVAL_ALLOWED_HOSTS;
  process.env.OPENEVAL_ALLOWED_HOSTS = "dashboard.internal";
  try {
    assert.equal(middleware(req("POST", {
      host: "dashboard.internal:3000",
      origin: "http://dashboard.internal:3000",
      "sec-fetch-site": "same-origin",
    })).status, 200);
  } finally {
    if (previous === undefined) delete process.env.OPENEVAL_ALLOWED_HOSTS;
    else process.env.OPENEVAL_ALLOWED_HOSTS = previous;
  }
});
