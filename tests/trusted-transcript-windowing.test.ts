import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../app/api/collection/transcript/route";
import { _setCollectionSourceDefsForTest, type CollectionSourceDef } from "../lib/collection/sources";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-trusted-transcript-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-trusted-outside-"));
const fixture = path.join(root, "session.jsonl");
const source: CollectionSourceDef = { id: "fixture-source", label: "Fixture source", roots: [root], format: "jsonl-dir", parseable: true };

function get(params: Record<string, string>): Promise<Response> {
  return GET(new Request(`http://localhost:3000/api/collection/transcript?${new URLSearchParams(params)}`));
}

function writeFixture(): void {
  const records = [
    { type: "system", sessionId: "fixture-session", timestamp: "2026-08-01T10:00:00.000Z" },
    ...Array.from({ length: 238 }, (_, i) => ({ type: "user", timestamp: "2026-08-01T10:00:01.000Z", message: { content: [{ type: "text", text: `before-${i}` }] } })),
    { type: "response_item", payload: { type: "function_call", call_id: "cross-window", name: "read", arguments: "{\"path\":\"ledger\"}" } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "cross-window", output: "Exit code: 0\nledger" } },
    ...Array.from({ length: 9 }, (_, i) => ({ type: "user", timestamp: "2026-08-01T10:00:02.000Z", message: { content: [{ type: "text", text: `after-${i}` }] } })),
  ];
  fs.writeFileSync(fixture, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

after(() => {
  _setCollectionSourceDefsForTest(null);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("source-qualified windows cap at 240, preserve tool pairing, and reject stale cursors", async () => {
  _setCollectionSourceDefsForTest([source]);
  writeFixture();
  const first = await get({ sourceId: source.id, sessionId: "fixture-session" });
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { turns: Array<{ preview: string; tool?: { name?: string; phase?: string } }>; nextCursor: string | null; hasMore: boolean };
  assert.equal(firstBody.turns.length, 240);
  assert.equal(firstBody.hasMore, true);
  assert.ok(firstBody.nextCursor);

  const originalReadSync = fs.readSync;
  let sequentialRead = false;
  (fs as unknown as { readSync: typeof fs.readSync }).readSync = ((...args: unknown[]) => {
    if (args[4] === null) sequentialRead = true;
    return originalReadSync(...args as Parameters<typeof fs.readSync>);
  }) as typeof fs.readSync;
  const second = await get({ cursor: firstBody.nextCursor! });
  (fs as unknown as { readSync: typeof fs.readSync }).readSync = originalReadSync;
  assert.equal(sequentialRead, false, "continuation must not rescan the file from byte zero");
  assert.equal(second.status, 200);
  const secondBody = await second.json() as { turns: Array<{ preview: string; tool?: { name?: string; phase?: string } }>; hasMore: boolean };
  assert.equal(secondBody.turns.length, 10);
  assert.equal(secondBody.turns[0]?.tool?.name, "read");
  assert.equal(secondBody.turns[0]?.tool?.phase, "result");
  assert.equal(secondBody.hasMore, false);

  fs.writeFileSync(fixture, fs.readFileSync(fixture, "utf8").replace("before-0", "rewritten-0"), "utf8");
  const stale = await get({ cursor: firstBody.nextCursor! });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).staleCursor, true);
});

test("a pruned source-qualified cursor resolves to the archived summary without reopening a replacement path", async () => {
  _setCollectionSourceDefsForTest([source]);
  writeFixture();
  const first = await get({ sourceId: source.id, sessionId: "fixture-session" });
  assert.equal(first.status, 200);
  const body = await first.json() as { nextCursor: string | null };
  assert.ok(body.nextCursor);

  // The route's normal source scan has already cached the session summary. A
  // cursor continuation must therefore disclose raw-unavailable archive state
  // after pruning, rather than accepting a client-provided replacement path.
  fs.rmSync(fixture);
  const archived = await get({ cursor: body.nextCursor! });
  assert.equal(archived.status, 410);
  const archivedBody = await archived.json() as { archived?: boolean; rawUnavailable?: boolean };
  assert.equal(archivedBody.archived, true);
  assert.equal(archivedBody.rawUnavailable, true);
});

test("Hermes single-JSON windows continue after the 240-turn cap", async () => {
  const hermes = { id: "hermes-fixture", label: "Hermes fixture", roots: [root], format: "hermes-json" as const, parseable: true };
  _setCollectionSourceDefsForTest([hermes]);
  const hermesFile = path.join(root, "session_20260801_window.json");
  fs.writeFileSync(hermesFile, JSON.stringify({
    session_id: "hermes-session",
    session_start: "2026-08-01T10:00:00.000Z",
    last_updated: "2026-08-01T10:01:00.000Z",
    messages: Array.from({ length: 245 }, (_, i) => ({ role: "user", content: `hermes-${i}` })),
  }), "utf8");

  const first = await get({ sourceId: hermes.id, sessionId: "hermes-session" });
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { turns: Array<{ preview: string }>; nextCursor: string | null; hasMore: boolean };
  assert.equal(firstBody.turns.length, 240);
  assert.equal(firstBody.hasMore, true);
  assert.ok(firstBody.nextCursor);

  const second = await get({ cursor: firstBody.nextCursor! });
  assert.equal(second.status, 200);
  const secondBody = await second.json() as { turns: Array<{ preview: string }>; hasMore: boolean };
  assert.equal(secondBody.turns.length, 7);
  assert.equal(secondBody.hasMore, false);
  assert.equal(new Set([...firstBody.turns, ...secondBody.turns].map((turn) => turn.preview)).size, 247);
});

test("resolver inventory rejects undiscovered, detect-only, wrong-format, source-mismatch, and escaping files", async () => {
  _setCollectionSourceDefsForTest([
    source,
    { id: "detect-only", label: "Detect only", roots: [root], format: "jsonl-dir", parseable: false, detectExts: [".jsonl"] },
    { id: "wrong-format", label: "Wrong format", roots: [root], format: "hermes-json", parseable: true },
  ]);
  fs.writeFileSync(path.join(root, "notes.txt"), "not a transcript", "utf8");
  fs.writeFileSync(path.join(outside, "escape.jsonl"), "{}\n", "utf8");
  try { fs.symlinkSync(path.join(outside, "escape.jsonl"), path.join(root, "escape.jsonl")); } catch { /* platform may forbid symlinks; the other inventory checks remain hermetic */ }

  assert.equal((await get({ sourceId: "missing-source", sessionId: "fixture-session" })).status, 404);
  assert.equal((await get({ sourceId: "detect-only", sessionId: "fixture-session" })).status, 404);
  assert.equal((await get({ sourceId: "wrong-format", sessionId: "fixture-session" })).status, 404);
  assert.equal((await get({ sourceId: source.id, sessionId: "not-discovered", pathHint: path.join(root, "notes.txt") })).status, 404);
  assert.equal((await get({ sourceId: source.id, sessionId: "fixture-session", pathHint: path.join(root, "escape.jsonl") })).status, 404);
});
