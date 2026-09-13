import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { GET } from "../app/api/collection/transcript/route";
import { readTranscriptWindow, parseSessionTranscript } from "../lib/live/transcript";
import { _setCollectionSourceDefsForTest } from "../lib/collection/sources";
import { normalizeNativeEvent, nativeIdentity, kimiSessionMetadata } from "../lib/live/native-events";
import { parseAgentDbSessions, agentDbRecords } from "../lib/live/parse-agent-db";
import { recentDateRange } from "../lib/chart-date-range";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-interactive-"));
after(() => { _setCollectionSourceDefsForTest(null); fs.rmSync(root, { recursive: true, force: true }); });
const get = (params: Record<string, string>) => GET(new Request(`http://localhost/api/collection/transcript?${new URLSearchParams(params)}`));

test("compound records crossing windows retain every block, including long message tails", async () => {
  const file = path.join(root, "compound.jsonl");
  const blocks = Array.from({ length: 300 }, (_, i) => ({ type: "tool_use", id: `call-${i}`, name: `tool-${i}`, input: { i } }));
  fs.writeFileSync(file, [JSON.stringify({ type: "system", sessionId: "compound" }), JSON.stringify({ type: "assistant", message: { content: blocks } }), JSON.stringify({ type: "user", message: { content: `${"prefix ".repeat(1000)}needle-after-preview` } })].join("\n"));
  const first = readTranscriptWindow(file, "jsonl-dir");
  assert.equal(first.turns.length, 240);
  assert.equal(first.nextState?.skipCandidates, 239);
  const next = readTranscriptWindow(file, "jsonl-dir", { byteOffset: first.nextByteOffset, state: first.nextState });
  assert.equal(next.turns[0].tool?.name, "tool-239");
  assert.equal(new Set([...first.turns, ...next.turns].flatMap(t => t.tool?.callId ?? [])).size, 300);
  assert.match(next.turns.at(-1)!.preview, /needle-after-preview/);
  assert.equal(next.done, true);
});

test("whole-session search locates messages after the first page and rejects source revisions and cross-session cursors", async () => {
  _setCollectionSourceDefsForTest([{ id: "interactive", label: "Interactive fixture", roots: [root], format: "jsonl-dir", parseable: true }]);
  const file = path.join(root, "search.jsonl");
  fs.writeFileSync(file, [JSON.stringify({ type: "system", sessionId: "search" }), ...Array.from({ length: 500 }, (_, i) => JSON.stringify({ type: "user", message: { content: i === 480 ? `${"long ".repeat(500)}distinct-tail` : `ordinary-${i}` } }))].join("\n"));
  let body = await (await get({ sourceId: "interactive", sessionId: "search", q: "distinct-tail" })).json();
  assert.equal(body.matches.length, 0); assert.equal(body.complete, false);
  let pages = 1;
  while (!body.complete) { body = await (await get({ cursor: body.nextCursor, q: "distinct-tail" })).json(); pages++; }
  assert.equal(pages, 3); assert.equal(body.matches.length, 1); assert.equal(body.matches[0].index, 481);
  const location = body.matches[0].windowCursor;
  const context = await (await get({ cursor: location })).json();
  assert.match(context.turns[481 - context.offset].preview, /distinct-tail/);
  assert.equal((await get({ sourceId: "interactive", sessionId: "different", cursor: location })).status, 400);
  fs.appendFileSync(file, "\n{}");
  assert.equal((await get({ cursor: location })).status, 409);
});

test("Kimi native records preserve user text, tool identity, and isolate request snapshots", () => {
  const record = (type: string, payload: object) => normalizeNativeEvent({ timestamp: 1780000000, message: { type, payload } }, "kimi-wire");
  assert.equal(record("TurnBegin", { user_input: "hello" }).type, "user");
  assert.equal(record("TextPart", { text: "answer" }).message.content[0].text, "answer");
  assert.equal(record("ToolCall", { id: "c", function: { name: "ReadFile", arguments: "{}" } }).message.content[0].id, "c");
  assert.equal(record("ToolResult", { tool_call_id: "c", return_value: { output: "ok", is_error: false } }).message.content[0].tool_use_id, "c");
  assert.equal(record("StatusUpdate", { token_usage: { input_other: 10 } }).type, "system");
  assert.deepEqual(nativeIdentity("/sessions/project/parent/agents/helper/wire.jsonl", "kimi-wire"), { sessionId: "parent/agent-helper", parentSessionId: "parent", isSubagent: true, agentLabel: "helper" });
});

test("DeepSeek v3 projects settled content and disjoint usage once, with required-event rejection", () => {
  const event = normalizeNativeEvent({ type: "assistant/message", seq: 1, time: 1780000000000, data: { message: { id: "m", content: [{ type: "text", text: "result" }, { type: "tool-call", id: "c" }], source: { kind: "model", model: "deepseek-v4" } }, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 50 } } }, "deepseek-jsonl");
  assert.equal(event.message.content.length, 1); assert.equal(event.message.model, "deepseek-v4"); assert.equal(event.message.usage.input_tokens, 10);
  assert.throws(() => normalizeNativeEvent({ type: "session", version: 99 }, "deepseek-jsonl"), /Unsupported/);
  assert.throws(() => normalizeNativeEvent({ type: "future/required", seq: 2, data: {} }, "deepseek-jsonl"), /Unsupported required/);
});

test("Grok exports keep fenced role headings as text and do not manufacture tool calls", () => {
  const file = path.join(root, "grok.md");
  fs.writeFileSync(file, "## User\n\nhello\n```md\n## Assistant\n```\n\n## Assistant\n\nanswer\n\n## Tools\n\n- read: done\n");
  const parsed = parseSessionTranscript(file, "grok-markdown");
  assert.equal(parsed.turns.filter(t => t.role === "assistant").length, 1);
  assert.match(parsed.turns.find(t => t.role === "user")!.preview, /## Assistant/);
  assert.equal(parsed.turns.filter(t => t.tool).length, 0);
});

test("OpenCode and ZCode database projection does not double-count step usage and follows WAL revisions", () => {
  const file = path.join(root, "db.sqlite"), db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE session(id TEXT,title TEXT,directory TEXT,time_created INTEGER,parent_id TEXT,version TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,time_created INTEGER,data TEXT)");
  db.prepare("INSERT INTO session VALUES(?,?,?,?,?,?)").run("s", "fixture", "/fixture", 1780000000000, null, "0.16.5");
  db.prepare("INSERT INTO message VALUES(?,?,?,?)").run("m", "s", 1780000000000, JSON.stringify({ role: "assistant", modelID: "glm-5.3", providerID: "zai", tokens: { input: 10, output: 3, cache: { read: 5, write: 0 } } }));
  db.prepare("INSERT INTO part VALUES(?,?,?,?)").run("p", "m", 1780000000000, JSON.stringify({ type: "text", text: "hello" }));
  db.prepare("INSERT INTO part VALUES(?,?,?,?)").run("p2", "m", 1780000000001, JSON.stringify({ type: "step-finish", tokens: { input: 10, output: 3 } }));
  try {
    const session = parseAgentDbSessions(file)[0];
    assert.equal(session.inputTokens, 10); assert.equal(session.outputTokens, 3); assert.equal(session.model, "glm-5.3");
    assert.deepEqual(session.observedProviders, ["zai"]);
    assert.equal(agentDbRecords(file, "s").length, 2);
    const first = readTranscriptWindow(file, "agent-sqlite", { sessionId: "s" });
    db.prepare("UPDATE part SET data = ? WHERE id = 'p'").run(JSON.stringify({ type: "text", text: "updated" }));
    const next = readTranscriptWindow(file, "agent-sqlite", { sessionId: "s" });
    assert.notEqual(first.revision.fingerprint, next.revision.fingerprint);
    assert.throws(() => agentDbRecords(file, "absent"), /absent/);
  } finally { db.close(); }
});

test("7d and 30d presets use UTC calendar boundaries across leap day", () => {
  const range = recentDateRange(7, Date.parse("2024-03-01T23:50:00Z"));
  assert.equal(new Date(range.fromMs).toISOString(), "2024-02-24T00:00:00.000Z");
  assert.equal(new Date(range.toMs).toISOString(), "2024-03-02T00:00:00.000Z");
  assert.equal(recentDateRange(30, range.fromMs).toMs - recentDateRange(30, range.fromMs).fromMs, 30 * 86400000);
});


test("Kimi state metadata is version checked and kept separate from model attribution", () => {
  const dir = path.join(root, "kimi-state", "agents", "main");
  fs.mkdirSync(dir, { recursive: true });
  const state = path.join(root, "kimi-state", "state.json");
  fs.writeFileSync(state, JSON.stringify({ version: 1, custom_title: "Recorded title", model: "untrusted-alias" }));
  assert.deepEqual(kimiSessionMetadata(path.join(dir, "wire.jsonl")), { title: "Recorded title" });
  fs.writeFileSync(state, JSON.stringify({ version: 99, custom_title: "unsupported" }));
  assert.match(kimiSessionMetadata(path.join(dir, "wire.jsonl")).warning!, /Unsupported/);
});

test("large-text transcript windows stop by bytes and resume without dropping a message", () => {
  const file = path.join(root, "large-window.jsonl");
  fs.writeFileSync(file, [JSON.stringify({ type: "system", sessionId: "large-window" }), ...Array.from({ length: 20 }, (_, i) => JSON.stringify({ type: "user", message: { content: `message-${i}: ${"x".repeat(700_000)}` } }))].join("\n"));
  const first = readTranscriptWindow(file, "jsonl-dir");
  assert.equal(first.done, false);
  assert.ok(Buffer.byteLength(JSON.stringify(first.turns)) < 8 * 1024 * 1024);
  const second = readTranscriptWindow(file, "jsonl-dir", { byteOffset: first.nextByteOffset, state: first.nextState });
  assert.equal(second.done, true);
  const messages = [...first.turns, ...second.turns].filter(turn => turn.role === "user");
  assert.equal(messages.length, 20);
  assert.equal(new Set(messages.map(turn => turn.preview.slice(0, 12))).size, 20);
});


test("search redacts complete source text before slicing excerpts", async () => {
  _setCollectionSourceDefsForTest([{ id: "redacted-search", label: "Fixture", roots: [root], format: "jsonl-dir", parseable: true }]);
  const key = "sk-" + "a".repeat(60);
  fs.writeFileSync(path.join(root, "redacted-search.jsonl"), [JSON.stringify({ type: "system", sessionId: "redacted-search" }), JSON.stringify({ type: "user", message: { content: `/Users/fixture-private-user/${"folder/".repeat(12)} ${key} needle` } })].join("\n"));
  const body = await (await get({ sourceId: "redacted-search", sessionId: "redacted-search", q: "needle" })).json();
  assert.equal(body.matches.length, 1);
  assert.doesNotMatch(body.matches[0].excerpt, /fixture-private-user|aaaa/);
  assert.match(body.matches[0].excerpt, /needle/);
});

test('search matches only redacted text and cannot disclose hidden username or secret matches', async () => {
  _setCollectionSourceDefsForTest([{ id: 'private-search', label: 'Fixture', roots: [root], format: 'jsonl-dir', parseable: true }]);
  const secret = 'sk-' + 'q'.repeat(60);
  fs.writeFileSync(path.join(root, 'private-search.jsonl'), [JSON.stringify({ type: 'system', sessionId: 'private-search' }), JSON.stringify({ type: 'user', message: { content: `safe-start /Users/hidden-person/work ${secret} safe-end` } })].join('\n'));
  for (const q of ['hidden-person', 'q'.repeat(12), 'Users/hidden-person']) {
    const response = await (await get({ sourceId: 'private-search', sessionId: 'private-search', q })).json();
    assert.equal(response.matches.length, 0, q); assert.equal(response.complete, true);
  }
  const body = await (await get({ sourceId: 'private-search', sessionId: 'private-search', q: 'safe-end' })).json();
  assert.equal(body.matches.length, 1); assert.match(body.matches[0].windowCursor, /^v2\./);
  assert.doesNotMatch(body.matches[0].excerpt, /hidden-person|qqqq/);
});
