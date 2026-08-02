import test, { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSessionTranscript } from "../lib/live";
import { _setCacheDbForTest } from "../lib/live-cache";

const cache = new Database(":memory:");
_setCacheDbForTest(cache);
after(() => { _setCacheDbForTest(null); cache.close(); });

function fixture(records: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-live-parser-quality-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"), "utf8");
  return file;
}

test("normalizes wrapped, flat, redacted, and compound reasoning without dropping adjacent evidence", () => {
  const file = fixture([
    { type: "response_item", timestamp: "2026-08-01T10:00:00.000Z", payload: { type: "reasoning", summary: { content: [{ type: "summary_text", text: "Compare the measured evidence." }] } } },
    { type: "agent_reasoning", timestamp: "2026-08-01T10:00:01.000Z", content: [{ type: "summary_text", text: "Check the source boundary." }] },
    { type: "response_item", timestamp: "2026-08-01T10:00:02.000Z", payload: { type: "redacted_thinking", encrypted_content: "sealed" } },
    { type: "assistant", timestamp: "2026-08-01T10:00:03.000Z", message: { content: [
      { type: "thinking", thinking: "Plan the safe change." },
      { type: "text", text: "I will make the change." },
      { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "lib/live/transcript.ts" } },
    ] } },
  ]);
  try {
    const parsed = parseSessionTranscript(file, "jsonl-dir");
    assert.equal(parsed.error, undefined);
    const reasoning = parsed.turns.filter((turn) => turn.reasoning);
    assert.equal(reasoning.length, 4);
    assert.deepEqual(reasoning.map((turn) => turn.reasoning?.kind), ["summary", "summary", "encrypted", "thinking"]);
    assert.deepEqual(reasoning.map((turn) => turn.reasoning?.source), ["codex", "generic", "codex", "claude"]);
    assert.match(reasoning[0].preview, /Compare the measured evidence/);
    assert.match(reasoning[1].preview, /Check the source boundary/);
    assert.equal(reasoning[2].preview, "(encrypted reasoning)");
    assert.match(reasoning[3].preview, /Plan the safe change/);
    assert.ok(parsed.turns.some((turn) => turn.label === "Assistant"));
    assert.ok(parsed.turns.some((turn) => turn.tool?.name === "Read"));
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("tolerates object-wrapped text and preserves a bounded unavailable marker", () => {
  const long = "reasoning ".repeat(10_000);
  const file = fixture([
    { type: "item.completed", item: { type: "agent_reasoning", summary: { text: long } } },
    { type: "item.completed", item: { type: "redacted_thinking", redacted_content: "sealed" } },
  ]);
  try {
    const parsed = parseSessionTranscript(file, "jsonl-dir");
    assert.equal(parsed.turns.length, 2);
    assert.equal(parsed.turns[0].reasoning?.kind, "summary");
    assert.ok(parsed.turns[0].preview.length <= 423);
    assert.equal(parsed.turns[1].reasoning?.kind, "encrypted");
    assert.equal(parsed.turns[1].preview, "(encrypted reasoning)");
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
