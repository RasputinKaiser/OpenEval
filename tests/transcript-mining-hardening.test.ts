import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { summarizeLiveSessionFile } from "../lib/live";
import { readConversationMessages } from "../lib/collection/conversation";
import { _setCacheDbForTest } from "../lib/live-cache";

/**
 * Transcript-mining hardening contract: a transcript may contain ANY valid
 * JSON per line (bare scalars, null, arrays, nested junk) without the parser
 * dropping the whole session or throwing into the caller's generator.
 */

const conn = new Database(":memory:");
_setCacheDbForTest(conn);

test("hardening: bare-scalar JSONL records never drop the session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oe-harden-"));
  const file = path.join(dir, "claude-hostile.jsonl");
  const good1 = JSON.stringify({ type: "user", timestamp: "2026-01-05T10:00:00.000Z", message: { role: "user", content: "hello" } });
  const good2 = JSON.stringify({ type: "assistant", timestamp: "2026-01-05T10:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  // Hostile-but-valid JSON lines interleaved with real records:
  const lines = [good1, "null", "42", '"just a string"', "[1,2,3]", "true", good2, '{"nested":{"deep":[1,2,{"x":null}]}}'];
  fs.writeFileSync(file, lines.join("\n") + "\n");

  const session = summarizeLiveSessionFile(file, "-Users-tester-projects-demo", Date.parse("2026-01-05T10:10:30.000Z"));
  assert.ok(session, "a transcript with valid-JSON garbage lines must still parse");
  assert.ok(session.numTurns >= 1, "real records survive alongside the junk");

  // Conversation mining yields the real messages and never throws:
  const mined = [...readConversationMessages(file)];
  assert.deepEqual(mined.map((m) => m.role), ["user", "assistant"]);
  assert.equal(mined[0].text, "hello");

  fs.rmSync(dir, { recursive: true, force: true });
  _setCacheDbForTest(null);
});

test("hardening: whole-file bare-scalar transcript caches as a null tombstone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oe-harden2-"));
  try {
    const file = path.join(dir, "claude-null.jsonl");
    fs.writeFileSync(file, "null\n");
    const st = fs.statSync(file);
    assert.equal(summarizeLiveSessionFile(file, "-Users-tester-projects-null", st.mtimeMs), null,
      "a file of only valid-JSON non-records has no transcript at all");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    _setCacheDbForTest(null);
  }
});
