import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyVolume } from "../lib/daily-volume";
const now = Date.UTC(2026, 8, 11, 12);
test("cache-only sessions retain a real daily usage bucket", () => {
  const result = buildDailyVolume([{startedAt:now,inputTokens:0,outputTokens:0,cacheReadTokens:100}],30,now);
  assert.equal(result.buckets.at(-1)?.cache,100);
  assert.equal(result.buckets.at(-1)?.sessions,1);
});
test("UTC day bounds agree with evidence selection and retain empty days", () => {
  const start = Date.UTC(2026,8,11);
  const result = buildDailyVolume([start-1,start,start+86399999,start+86400000].map(startedAt=>({startedAt,inputTokens:1,outputTokens:0,cacheReadTokens:0})),2,now);
  assert.deepEqual(result.buckets.map(b=>b.input),[1,2]);
  assert.equal(result.buckets.length,2);
});
test("malformed usage and timestamps cannot create NaN geometry", () => {
  const result=buildDailyVolume([{startedAt:NaN,inputTokens:1,outputTokens:0,cacheReadTokens:0},{startedAt:now,inputTokens:NaN,outputTokens:-2,cacheReadTokens:4}],NaN,now);
  assert.equal(result.excluded,1);
  assert.equal(result.buckets.at(-1)?.cache,4);
  assert.ok(result.buckets.every(b=>Number.isFinite(b.input+b.output+b.cache)));
});
