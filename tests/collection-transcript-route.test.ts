import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../app/api/collection/transcript/route";
import { _setCollectionSourceDefsForTest } from "../lib/collection/sources";
import { MAX_JSONL_RECORD_BYTES } from "../lib/live/util";

const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-transcript-route-"));
const fixture = path.join(sourceRoot, `.openeval-transcript-window-${process.pid}-${crypto.randomUUID()}.jsonl`);

after(() => {
  _setCollectionSourceDefsForTest(null);
  try { fs.unlinkSync(fixture); } catch {}
  fs.rmSync(sourceRoot, { recursive: true, force: true });
});

function get(params: Record<string, string>): Promise<Response> {
  const query = new URLSearchParams(params);
  return GET(new Request(`http://localhost:3000/api/collection/transcript?${query}`));
}

function digest(): string {
  return crypto.createHash("sha256").update(fs.readFileSync(fixture)).digest("hex");
}

test("transcript route pages appended records without caching or mutating the raw file", async () => {
  _setCollectionSourceDefsForTest([{ id: "route-fixture", label: "Route fixture", roots: [sourceRoot], format: "jsonl-dir", parseable: true }]);

  const records = (start: number, count: number) => Array.from({ length: count }, (_, i) => JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: `window-${start + i}` },
  }));
  fs.writeFileSync(fixture, [
    JSON.stringify({ type: "system", sessionId: "legacy-session", timestamp: "2026-08-01T10:00:00.000Z" }),
    ...records(0, 245),
  ].join("\n") + "\n", "utf8");

  const beforeFirstRead = digest();
  const legacy = await get({ file: fixture, offset: "0", limit: "240" });
  assert.equal(digest(), beforeFirstRead, "the first GET must not rewrite the raw transcript");
  assert.equal(legacy.status, 307);
  assert.equal(legacy.headers.get("cache-control"), "private, no-store");
  const location = new URL(legacy.headers.get("location") ?? "");
  assert.equal(location.searchParams.get("sourceId"), "route-fixture");
  assert.equal(location.searchParams.get("sessionId"), "legacy-session");

  const first = await get({ sourceId: "route-fixture", sessionId: "legacy-session" });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  const firstBody = await first.json();
  assert.equal(firstBody.turns.length, 240);
  assert.equal(firstBody.total, undefined, "the canonical first window must not scan for an exact total");

  const beforeRead = digest();
  const second = await get({ cursor: firstBody.nextCursor });
  const afterRead = digest();
  assert.equal(second.status, 200);
  assert.equal(afterRead, beforeRead, "GET must not rewrite the raw transcript");
  const secondBody = await second.json();
  assert.equal(secondBody.total, 246);
  assert.equal(secondBody.turns.length, 6);
  assert.equal(new Set([...firstBody.turns, ...secondBody.turns].map((turn: { preview: string }) => turn.preview)).size, 246);

  const legacyWithOffset = await get({ file: fixture, offset: "-1", limit: "0" });
  assert.equal(legacyWithOffset.status, 307, "legacy offset values cannot bypass canonical cursor hydration");
  const outside = await get({ file: path.join(os.tmpdir(), "not-a-collection-transcript.jsonl"), offset: "0", limit: "240" });
  assert.equal(outside.status, 404);
});

test("transcript route exposes an oversized newline-free record as a bounded warning", async () => {
  _setCollectionSourceDefsForTest([{ id: "route-fixture", label: "Route fixture", roots: [sourceRoot], format: "jsonl-dir", parseable: true }]);
  const oversized = path.join(sourceRoot, `oversized-${crypto.randomUUID()}.jsonl`);
  fs.writeFileSync(oversized, [
    JSON.stringify({ type: "system", sessionId: "oversized-session", timestamp: "2026-08-01T10:00:00.000Z" }),
    `{"type":"assistant","message":"${"x".repeat(MAX_JSONL_RECORD_BYTES + 512)}`,
  ].join("\n"), "utf8");

  const response = await get({ sourceId: "route-fixture", sessionId: "oversized-session" });
  assert.equal(response.status, 200);
  const body = await response.json();
  const warning = body.turns.find((turn: { type?: string; severity?: string }) => turn.type === "truncated");
  assert.ok(warning);
  assert.equal(warning.severity, "warning");
  assert.match(warning.label, /malformed\/truncated JSONL record/i);
  assert.match(warning.preview, new RegExp(`${MAX_JSONL_RECORD_BYTES}.*limit`));
  assert.equal(body.nextCursor, null);
});
