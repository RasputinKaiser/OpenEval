import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractSearchText } from "../lib/collection/search";

function tempFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-search-test-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test("extractSearchText indexes legacy Codex response_item messages", () => {
  const file = tempFile("codex.jsonl", [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "repair the ledger totals" }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "The ledger now balances." }] } },
  ].map((record) => JSON.stringify(record)).join("\n"));

  assert.deepEqual(extractSearchText(file), {
    userText: "repair the ledger totals",
    assistantText: "The ledger now balances.",
    title: "repair the ledger totals",
  });
});

test("extractSearchText indexes Hermes single-JSON conversations", () => {
  const file = tempFile("hermes.json", JSON.stringify({
    session_id: "hermes-search",
    messages: [
      { role: "user", content: "trace the missing invoice" },
      { role: "assistant", content: "The invoice was restored." },
      { role: "tool", content: "internal tool noise" },
    ],
  }, null, 2));

  assert.deepEqual(extractSearchText(file), {
    userText: "trace the missing invoice",
    assistantText: "The invoice was restored.",
    title: "trace the missing invoice",
  });
});
