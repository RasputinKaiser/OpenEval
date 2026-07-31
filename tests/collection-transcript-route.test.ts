import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../app/api/collection/transcript/route";

const sourceRoot = path.join(os.homedir(), ".codex", "sessions");
const fixture = path.join(sourceRoot, `.openeval-transcript-window-${process.pid}-${crypto.randomUUID()}.jsonl`);

after(() => {
  try { fs.unlinkSync(fixture); } catch {}
});

function get(params: Record<string, string>): Promise<Response> {
  const query = new URLSearchParams(params);
  return GET(new Request(`http://localhost:3000/api/collection/transcript?${query}`));
}

function digest(): string {
  return crypto.createHash("sha256").update(fs.readFileSync(fixture)).digest("hex");
}

test("transcript route pages appended records without caching or mutating the raw file", async (t) => {
  if (!fs.existsSync(sourceRoot)) {
    t.skip("Codex collection source is not present on this machine");
    return;
  }

  const records = (start: number, count: number) => Array.from({ length: count }, (_, i) => JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: `window-${start + i}` },
  }));
  fs.writeFileSync(fixture, `${records(0, 245).join("\n")}\n`, "utf8");

  const beforeFirstRead = digest();
  const first = await get({ file: fixture, offset: "0", limit: "240" });
  assert.equal(digest(), beforeFirstRead, "the first GET must not rewrite the raw transcript");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  const firstBody = await first.json();
  assert.equal(firstBody.turns.length, 240);
  assert.equal(firstBody.total, 245);
  assert.deepEqual(firstBody.counts, { all: 245, chat: 245, tools: 0, errors: 0 });
  assert.deepEqual(firstBody.normalization, { rawRecords: 245, suppressedMirrors: 0, compoundRecords: 0 });

  fs.appendFileSync(fixture, `${records(245, 5).join("\n")}\n`, "utf8");
  const beforeRead = digest();
  const second = await get({ file: fixture, offset: "240", limit: "240" });
  const afterRead = digest();
  assert.equal(second.status, 200);
  assert.equal(afterRead, beforeRead, "GET must not rewrite the raw transcript");
  const secondBody = await second.json();
  assert.equal(secondBody.total, 250);
  assert.equal(secondBody.turns.length, 10);
  assert.deepEqual(secondBody.normalization, { rawRecords: 250, suppressedMirrors: 0, compoundRecords: 0 });
  assert.deepEqual(secondBody.turns.map((turn: { preview: string }) => turn.preview), Array.from({ length: 10 }, (_, i) => `window-${240 + i}`));
  assert.equal(new Set([...firstBody.turns, ...secondBody.turns].map((turn: { preview: string }) => turn.preview)).size, 250);

  const badOffset = await get({ file: fixture, offset: "-1", limit: "240" });
  assert.equal(badOffset.status, 400);
  const badLimit = await get({ file: fixture, offset: "0", limit: "0" });
  assert.equal(badLimit.status, 400);
  const outside = await get({ file: path.join(os.tmpdir(), "not-a-collection-transcript.jsonl"), offset: "0", limit: "240" });
  assert.equal(outside.status, 403);
});
