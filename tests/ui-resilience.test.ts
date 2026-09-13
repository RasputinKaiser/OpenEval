import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../lib/client-request";
import { readSavedViews } from "../lib/saved-analysis-views";

test("bounded requests distinguish timeout, cancellation and unreadable responses", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    await assert.rejects(requestJson("/slow", { message: "Search failed.", timeoutMs: 5 }), /took too long/);
    const parent = new AbortController(); parent.abort();
    await assert.rejects(requestJson("/cancel", { signal: parent.signal, message: "Search failed." }), { name: "AbortError" });
    globalThis.fetch = async () => new Response("<html>proxy failure</html>");
    await assert.rejects(requestJson("/broken", { message: "Search failed." }), /unreadable response/);
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(requestJson("/offline", { message: "Search failed." }), /Check that OpenEval is running/);
  } finally { globalThis.fetch = original; }
});

test("request recovery messages distinguish changed revisions and rate limits", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("private server output", { status: 409 });
    await assert.rejects(requestJson("/changed", { message: "Search failed." }), /source changed/);
    globalThis.fetch = async () => new Response("private server output", { status: 429 });
    await assert.rejects(requestJson("/busy", { message: "Search failed." }), /Wait a moment/);
    globalThis.fetch = async () => Response.json({ matches: [1] });
    assert.deepEqual(await requestJson("/ok", { message: "Search failed." }), { matches: [1] });
  } finally { globalThis.fetch = original; }
});

test("saved views sanitize storage, bound counts and preserve multilingual names", () => {
  const raw = JSON.stringify([null, {}, { name: "", query: "" }, { name: "日本語 تجربة 🔎", query: "vizModel=model-one&file=private&token=secret" }, { name: " repeat ", query: "vizModel=old" }, { name: "repeat", query: "vizModel=new" }]);
  const rows = readSavedViews(raw);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "日本語 تجربة 🔎");
  assert.equal(rows[0].query, "vizModel=model-one");
  assert.equal(rows[1].query, "vizModel=new");
  assert.equal(readSavedViews(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ name: `view${i}`, query: "" })))).length, 10);
  assert.throws(() => readSavedViews("null"), /unreadable/);
  assert.throws(() => readSavedViews("x".repeat(50_001)), /storage limit/);
});
