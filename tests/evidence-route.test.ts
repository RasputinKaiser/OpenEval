import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { GET } from "../app/api/collection/evidence/route";
import { _setCollectionSourceDefsForTest } from "../lib/collection/sources";
import { _setCacheDbForTest, saveJudgeReceipt } from "../lib/live-cache";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-evidence-route-"));
const cache = new Database(":memory:");
_setCacheDbForTest(cache);
_setCollectionSourceDefsForTest([{ id: "fixture-evidence", label: "Fixture", roots: [root], format: "jsonl-dir", parseable: true }]);
after(() => { _setCollectionSourceDefsForTest(null); _setCacheDbForTest(null); cache.close(); fs.rmSync(root, { recursive: true, force: true }); });
const get = (params: Record<string, string>) => GET(new Request(`http://localhost/api/collection/evidence?${new URLSearchParams(params)}`));

test("evidence endpoint rejects paths and invalid references before source reads", async () => {
  assert.equal((await get({})).status, 400);
  assert.equal((await get({ sourceId: "fixture-evidence", sessionId: "x", file: "/etc/passwd" })).status, 400);
  assert.equal((await get({ sourceId: "missing", sessionId: "x" })).status, 404);
});

test("source-qualified packet reads preserve source bytes and expose claim uncertainty", async () => {
  const file = path.join(root, "one.jsonl");
  const raw = [
    { type: "system", sessionId: "evidence-one", timestamp: "2026-08-01T10:00:00.000Z" },
    { type: "user", message: { content: "Fix the bug" } },
    { type: "assistant", message: { content: [{ type: "text", text: "All tests passed" }] } },
  ].map(item => JSON.stringify(item)).join("\n");
  fs.writeFileSync(file, raw);
  const response = await get({ sourceId: "fixture-evidence", sessionId: "evidence-one" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.packet.sourceId, "fixture-evidence");
  assert.equal(body.packet.sessionId, "evidence-one");
  assert.equal(body.packet.evaluation.verification.status, "unknown");
  assert.ok(body.packet.records.length <= 256);
  assert.ok(!JSON.stringify(body).includes(root));
  assert.equal(fs.readFileSync(file, "utf8"), raw);
  saveJudgeReceipt({ receiptId: "fixture-receipt", file, sourceId: "fixture-evidence", sessionId: "evidence-one", revision: "fixture", evidenceDigest: body.packet.contentDigest, evidenceVersion: body.packet.version, promptVersion: 4, outcome: "insufficient_evidence", score: null, confidence: "low", reasons: ["No execution receipt"], evidenceIds: [], contradictionEvidenceIds: [], judge: "stub", createdAt: Date.now() });
  const history = await (await get({ sourceId: "fixture-evidence", sessionId: "evidence-one" })).json();
  assert.equal(history.receipts.length, 1);
  assert.equal(history.receipts[0].score, null);
  assert.equal(history.receipts[0].evidenceMatches, true);
  assert.equal(history.receipts[0].promptMatches, true);
  assert.ok(!JSON.stringify(history).includes(root));
  fs.appendFileSync(file, '\n' + JSON.stringify({ type: "user", message: { content: "The work is incomplete" } }));
  const changed = await (await get({ sourceId: "fixture-evidence", sessionId: "evidence-one" })).json();
  assert.equal(changed.receipts[0].evidenceMatches, false);
  assert.equal(changed.receipts[0].score, null);
});
