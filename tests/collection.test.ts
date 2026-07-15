import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allCollectionSources, defToSpec, KNOWN_COLLECTION_SOURCES } from "../lib/collection/sources";
import { looksLikeTranscriptFile } from "../lib/collection/discover";
import { scanSourceSessions } from "../lib/live";

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-collect-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

// ---- looksLikeTranscriptFile (unknown-source heuristic) ----

test("looksLikeTranscriptFile accepts transcript-shaped JSONL", () => {
  const claudeish = tmpFile("s.jsonl", [
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: "do it" } }),
  ].join("\n"));
  assert.equal(looksLikeTranscriptFile(claudeish), true);

  const codexish = tmpFile("c.jsonl", [
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "shell" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "ok" } }),
  ].join("\n"));
  assert.equal(looksLikeTranscriptFile(codexish), true);
});

test("looksLikeTranscriptFile rejects non-transcript and non-JSON content", () => {
  const metrics = tmpFile("m.jsonl", [
    JSON.stringify({ cpu: 0.4, mem: 1234, ts: 1 }),
    JSON.stringify({ cpu: 0.5, mem: 2345, ts: 2 }),
  ].join("\n"));
  assert.equal(looksLikeTranscriptFile(metrics), false);
  assert.equal(looksLikeTranscriptFile(tmpFile("p.jsonl", "not json at all\nplain text")), false);
  assert.equal(looksLikeTranscriptFile(tmpFile("e.jsonl", "")), false);
});

test("looksLikeTranscriptFile inspects only the head of large files", () => {
  const transcriptLines = Array.from({ length: 8 }, (_, i) =>
    JSON.stringify({ type: "user", message: { role: "user", content: `msg ${i}` } }),
  ).join("\n");
  // Transcript head followed by a giant line cut off at the 64KB read boundary.
  const bigTail = tmpFile("tail.jsonl", transcriptLines + "\n" + "x".repeat(200 * 1024));
  assert.equal(looksLikeTranscriptFile(bigTail), true);
  // A head filled by one giant non-transcript line never parses as one.
  const bigHead = tmpFile("head.jsonl", "x".repeat(70 * 1024) + "\n" + transcriptLines);
  assert.equal(looksLikeTranscriptFile(bigHead), false);
});

// ---- registry composition ----

test("allCollectionSources includes runnable harnesses and curated extras", () => {
  const sources = allCollectionSources();
  const ids = new Set(sources.map((s) => s.id));
  // runnable harnesses that declare liveTrace
  assert.ok(ids.has("claude-code"), "claude-code present");
  assert.ok(ids.has("codex"), "codex present");
  // curated collection-only extras
  assert.ok(ids.has("cursor"), "cursor present");
  assert.ok(ids.has("goose"), "goose present");
  // adapter-derived sources are marked parseable
  assert.equal(sources.find((s) => s.id === "claude-code")?.parseable, true);
  // detect-only extras are honest about not being parsed
  assert.equal(sources.find((s) => s.id === "cursor")?.parseable, false);
});

test("curated extras never duplicate an adapter's root", () => {
  const sources = allCollectionSources();
  const rootCounts = new Map<string, number>();
  for (const s of sources) for (const r of s.roots) rootCounts.set(r, (rootCounts.get(r) ?? 0) + 1);
  for (const [root, count] of rootCounts) assert.equal(count, 1, `root ${root} claimed by ${count} sources`);
});

test("defToSpec forwards the scanner-relevant fields", () => {
  const def = KNOWN_COLLECTION_SOURCES.find((d) => d.id === "goose")!;
  const spec = defToSpec(def);
  assert.equal(spec.id, "goose");
  assert.equal(spec.format, def.format);
  assert.deepEqual(spec.roots, def.roots);
});

// ---- scanSourceSessions (arbitrary source, reusing the harness scanner) ----

test("scanSourceSessions parses a jsonl-dir source of an arbitrary harness", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-src-"));
  fs.writeFileSync(
    path.join(dir, "session.jsonl"),
    [
      { type: "system", sessionId: "abc", cwd: "/tmp/proj", timestamp: "2026-06-28T20:00:00.000Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "done" }, { type: "tool_use", id: "t1", name: "shell", input: { cmd: "ls" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false }] } },
    ].map((l) => JSON.stringify(l)).join("\n"),
    "utf8",
  );
  const agg = scanSourceSessions({ id: "custom", label: "Custom", roots: [dir], format: "jsonl-dir" }, 50);
  assert.equal(agg.totalSessions, 1);
  assert.equal(agg.sessions[0].toolCalls, 1);
  assert.equal(agg.totalToolCalls, 1);
});

test("scanSourceSessions on an absent root yields an empty aggregate, not a throw", () => {
  const agg = scanSourceSessions({ id: "nope", label: "Nope", roots: ["/nonexistent/path/xyz"], format: "jsonl-dir" }, 50);
  assert.equal(agg.totalSessions, 0);
});

// ---- archive: sessions outlive their files ----

test("scanSourceSessions keeps archived sessions after their files are pruned", () => {
  const Database = require("better-sqlite3");
  const { _setCacheDbForTest } = require("../lib/live-cache");
  const conn = new Database(":memory:");
  _setCacheDbForTest(conn);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-archive-"));
    const mk = (name: string, sessionId: string) =>
      fs.writeFileSync(
        path.join(dir, name),
        [
          { type: "system", sessionId, cwd: "/tmp/proj", timestamp: "2026-06-28T20:00:00.000Z" },
          { type: "assistant", message: { content: [{ type: "text", text: "done" }] } },
          { type: "result", duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } },
        ].map((l) => JSON.stringify(l)).join("\n"),
        "utf8",
      );
    const spec = { id: "arch", label: "Arch", roots: [dir], format: "jsonl-dir" as const };

    mk("old.jsonl", "old-session");
    assert.equal(scanSourceSessions(spec, 50, { includeArchived: true }).totalSessions, 1);

    // The harness prunes the old transcript; a new session appears.
    fs.rmSync(path.join(dir, "old.jsonl"));
    mk("new.jsonl", "new-session");

    const agg = scanSourceSessions(spec, 50, { includeArchived: true });
    assert.equal(agg.totalSessions, 2, "pruned session must survive via the archive");
    assert.equal(agg.archivedSessions, 1);
    const archived = agg.sessions.find((s) => s.sessionId === "old-session");
    assert.equal(archived?.archived, true);
    assert.equal(agg.sessions.find((s) => s.sessionId === "new-session")?.archived, undefined);

    // Without the flag (Live page), archived sessions stay hidden.
    assert.equal(scanSourceSessions(spec, 50).totalSessions, 1);
  } finally {
    _setCacheDbForTest(null);
    conn.close();
  }
});

// ---- judge self-sessions are instrumentation, not user work ----

test("parsers drop OpenEval's own judge-stub sessions", () => {
  const { JUDGE_PROMPT_MARKER } = require("../lib/insights/signals");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judgestub-"));
  // Claude-shaped stub (claude -p judge invocation).
  fs.writeFileSync(path.join(dir, "stub.jsonl"), [
    { type: "user", message: { role: "user", content: `${JUDGE_PROMPT_MARKER} achieved the user's goal.\nReply with ONLY JSON.` } },
    { type: "assistant", message: { content: [{ type: "text", text: '{"score":0.5}' }] } },
  ].map((l) => JSON.stringify(l)).join("\n"), "utf8");
  // A real session next to it still parses.
  fs.writeFileSync(path.join(dir, "real.jsonl"), [
    { type: "system", sessionId: "real", cwd: "/tmp/p", timestamp: "2026-06-28T20:00:00.000Z" },
    { type: "user", message: { role: "user", content: "fix the bug" } },
    { type: "result", duration_ms: 10, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } },
  ].map((l) => JSON.stringify(l)).join("\n"), "utf8");
  const agg = scanSourceSessions({ id: "js", label: "JS", roots: [dir], format: "jsonl-dir" }, 50);
  assert.equal(agg.totalSessions, 1);
  assert.equal(agg.sessions[0].sessionId, "real");
});

// ---- cross-source rollup merges ----

test("mergeModelRollups sums the same model across sources and sorts by cost", () => {
  const { mergeModelRollups } = require("../lib/collection/aggregate");
  const merged = mergeModelRollups([
    [
      { model: "claude-opus-4-8", sessions: 2, inputTokens: 100, outputTokens: 10, cacheReadTokens: 500, costUsd: 4, toolCalls: 6, toolErrors: 1 },
      { model: "gpt-5.5", sessions: 1, inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, costUsd: 1, toolCalls: 2, toolErrors: 0 },
    ],
    [{ model: "claude-opus-4-8", sessions: 3, inputTokens: 200, outputTokens: 20, cacheReadTokens: 700, costUsd: 6, toolCalls: 4, toolErrors: 0 }],
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].model, "claude-opus-4-8");
  assert.equal(merged[0].sessions, 5);
  assert.equal(merged[0].inputTokens, 300);
  assert.equal(merged[0].cacheReadTokens, 1200);
  assert.equal(merged[0].costUsd, 10);
  assert.equal(merged[0].toolErrors, 1);
  assert.equal(merged[1].model, "gpt-5.5");
});

test("mergeToolRollups sums tools across sources, sorts by calls, and caps the list", () => {
  const { mergeToolRollups } = require("../lib/collection/aggregate");
  const a = [
    { name: "Bash", calls: 10, errors: 2 },
    { name: "Read", calls: 30, errors: 0 },
  ];
  const b = [{ name: "Bash", calls: 15, errors: 1 }];
  const merged = mergeToolRollups([a, b]);
  assert.deepEqual(merged[0], { name: "Read", calls: 30, errors: 0 });
  assert.deepEqual(merged[1], { name: "Bash", calls: 25, errors: 3 });

  const many = Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, calls: i, errors: 0 }));
  assert.equal(mergeToolRollups([many], 12).length, 12);
});

// ---- Hermes single-JSON sessions ----

test("hermes-json sessions parse into model, tools, and duration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-hermes-"));
  fs.writeFileSync(path.join(dir, "session_20260531_000552_3e2fd6.json"), JSON.stringify({
    session_id: "20260531_000552_3e2fd6",
    model: "gpt-5.5",
    platform: "cli",
    session_start: "2026-05-31T00:05:53.370621",
    last_updated: "2026-05-31T00:06:53.370621",
    message_count: 4,
    messages: [
      { role: "user", content: "list the files" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "bash", arguments: "{\"cmd\":\"ls\"}" } }] },
      { role: "tool", tool_call_id: "t1", content: "a.txt b.txt" },
      { role: "assistant", content: "Two files: a.txt and b.txt." },
    ],
  }, null, 2), "utf8");
  // A request_dump payload log next to it must NOT be collected as a session.
  fs.writeFileSync(path.join(dir, "request_dump_20260531_000552.json"), "{}", "utf8");

  const agg = scanSourceSessions({ id: "hermes", label: "Hermes", roots: [dir], format: "hermes-json" }, 50);
  assert.equal(agg.totalSessions, 1);
  const s = agg.sessions[0];
  assert.equal(s.model, "gpt-5.5");
  assert.equal(s.sessionId, "20260531_000552_3e2fd6");
  assert.equal(s.toolCalls, 1);
  assert.equal(s.durationMs, 60000);
  assert.equal(s.metricSources.duration, "measured");
  assert.equal(s.metricSources.tokens, "missing"); // Hermes records no usage
  assert.equal(s.startedAt, Date.parse("2026-05-31T00:05:53.370621"));
});
