import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractSearchText, SEARCH_QUERY_MAX_CHARS, SEARCH_TEXT_CAP_PER_SIDE } from "../lib/collection/search";
import { GET as searchRoute } from "../app/api/collection/search/route";

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

test("extractSearchText indexes bounded tool names, arguments, and results", () => {
  const file = tempFile("codex-tools.jsonl", [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "inspect the deployment" }] } },
    { timestamp: "2026-07-30T00:00:00.000Z", type: "response_item", payload: { type: "custom_tool_call", call_id: "c1", name: "exec", status: "completed", input: "curl cache-busted.example" } },
    { timestamp: "2026-07-30T00:00:01.250Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", status: "completed", output: [{ type: "input_text", text: "asset-sha-abcdef matched" }] } },
  ].map((record) => JSON.stringify(record)).join("\n"));

  const indexed = extractSearchText(file);
  assert.equal(indexed.userText, "inspect the deployment");
  assert.match(indexed.assistantText, /\[Tool: exec\].*call:c1.*status:completed.*cache-busted\.example/);
  assert.match(indexed.assistantText, /\[exec result\].*call:c1.*status:completed.*duration:1250ms.*asset-sha-abcdef matched/);
  assert.ok(indexed.assistantText.length <= SEARCH_TEXT_CAP_PER_SIDE);
});

test("extractSearchText indexes each tool in compound Claude records", () => {
  const file = tempFile("claude-tools.jsonl", [
    {
      type: "assistant",
      timestamp: "2026-07-30T00:00:00.000Z",
      message: { content: [
        { type: "text", text: "I will inspect both sources." },
        { type: "tool_use", id: "bash-1", name: "Bash", input: { command: "npm test" } },
        { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "state.yaml" } },
      ] },
    },
    {
      type: "user",
      timestamp: "2026-07-30T00:00:02.000Z",
      message: { content: [
        { type: "tool_result", tool_use_id: "bash-1", content: "semantic-tool-result" },
        { type: "tool_result", tool_use_id: "read-1", content: "state-loaded" },
      ] },
    },
  ].map((record) => JSON.stringify(record)).join("\n"));

  const indexed = extractSearchText(file);
  assert.match(indexed.assistantText, /\[Tool: Bash\].*npm test/);
  assert.match(indexed.assistantText, /\[Tool: Read\].*state\.yaml/);
  assert.match(indexed.assistantText, /\[Bash result\].*semantic-tool-result/);
  assert.match(indexed.assistantText, /\[Read result\].*state-loaded/);
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
    assistantText: "The invoice was restored.\n[Tool result] internal tool noise",
    title: "trace the missing invoice",
  });
});

test("extractSearchText preserves a genuinely repeated prompt after an assistant turn", () => {
  const file = tempFile("codex-repeat.jsonl", [
    { type: "event_msg", payload: { type: "user_message", message: "retry the migration" } },
    { type: "event_msg", payload: { type: "agent_message", message: "The migration still fails." } },
    { type: "event_msg", payload: { type: "user_message", message: "retry the migration" } },
  ].map((record) => JSON.stringify(record)).join("\n"));

  assert.equal(extractSearchText(file).userText, "retry the migration\nretry the migration");
});

test("extractSearchText collapses Codex event/response echoes after normalizing IDE context", () => {
  const wrapped =
    "# Context from my IDE setup:\n\n## Active file: AGENTS.md\n\n## My request for Codex:\nrepair the ledger totals";
  const file = tempFile("codex-echo.jsonl", [
    { type: "event_msg", payload: { type: "user_message", message: wrapped } },
    { type: "response_item", payload: { type: "message", role: "user", content: [
      { type: "input_text", text: "<environment_context>ignored</environment_context>" },
      { type: "input_text", text: "repair the ledger totals" },
    ] } },
    { type: "event_msg", payload: { type: "agent_message", message: "The ledger now balances." } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [
      { type: "output_text", text: "The ledger now balances." },
    ] } },
  ].map((record) => JSON.stringify(record)).join("\n"));

  assert.deepEqual(extractSearchText(file), {
    userText: "repair the ledger totals",
    assistantText: "The ledger now balances.",
    title: "repair the ledger totals",
  });
});

test("extractSearchText bounds durable storage while retaining task head and result tail", () => {
  const headMarker = "HEAD-TASK";
  const tailMarker = "TAIL-RESULT";
  const file = tempFile("codex-bounded.jsonl", [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `${headMarker} ${"a".repeat(24_000)}` }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `${"b".repeat(24_000)} ${tailMarker}` }] } },
  ].map((record) => JSON.stringify(record)).join("\n"));

  const indexed = extractSearchText(file);
  assert.equal(indexed.userText.length, SEARCH_TEXT_CAP_PER_SIDE);
  assert.ok(indexed.userText.startsWith(headMarker));
  assert.ok(indexed.userText.endsWith(tailMarker));
  assert.match(indexed.userText, /\[…\]/);
});

test("collection search route rejects oversized queries instead of building an unbounded MATCH expression", async () => {
  const query = "x".repeat(SEARCH_QUERY_MAX_CHARS + 1);
  const response = await searchRoute(new Request(`http://localhost/api/collection/search?q=${query}`));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /limited to/);
});
