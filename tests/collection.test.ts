import test, { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allCollectionSources, defToSpec, KNOWN_COLLECTION_SOURCES, type CollectionSourceDef } from "../lib/collection/sources";
import { looksLikeTranscriptFile, type DiscoveredSource } from "../lib/collection/discover";
import { _setCacheDbForTest } from "../lib/live-cache";
import { collectSourceFiles, scanSourceSessions } from "../lib/live";
import { _setCollectionHooksForTest, collectAllSessions, fingerprintDiscovery, scanAllSources } from "../lib/collection/aggregate";
import { buildRollup } from "../lib/collection/rollup";

// Every scan goes through the live-cache; use a file-level in-memory DB so
// parallel test processes never race on the shared .test-data SQLite cache.
// Tests that need their own connection restore THIS one (not null) when done,
// otherwise later tests would silently fall back to the persistent cache.
const fileCacheDb = new Database(":memory:");
_setCacheDbForTest(fileCacheDb);
after(() => {
  _setCacheDbForTest(null);
  fileCacheDb.close();
});

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
    assert.equal(archived?.parseWarnings.some((warning) => warning.includes("archived parse")), false);
    assert.equal(agg.sessions.find((s) => s.sessionId === "new-session")?.archived, undefined);

    // Without the flag (Live page), archived sessions stay hidden.
    assert.equal(scanSourceSessions(spec, 50).totalSessions, 1);
  } finally {
    _setCacheDbForTest(fileCacheDb);
    conn.close();
  }
});

test("scanSourceSessions labels pruned sessions cached by an older parser", () => {
  const Database = require("better-sqlite3");
  const { PARSER_VERSION, _setCacheDbForTest } = require("../lib/live-cache");
  const conn = new Database(":memory:");
  _setCacheDbForTest(conn);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-stale-archive-"));
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, [
      { type: "system", sessionId: "stale-archived", cwd: "/tmp/proj", timestamp: "2026-06-28T20:00:00.000Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "done" }] } },
      { type: "result", duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } },
    ].map((line) => JSON.stringify(line)).join("\n"), "utf8");
    const spec = { id: "stale-arch", label: "Stale archive", roots: [dir], format: "jsonl-dir" as const };

    scanSourceSessions(spec, 50, { includeArchived: true });
    conn.prepare("UPDATE session_cache SET parser_version = ? WHERE file = ?").run(PARSER_VERSION - 1, file);
    fs.rmSync(file);

    const agg = scanSourceSessions(spec, 50, { includeArchived: true });
    assert.equal(agg.totalSessions, 1);
    assert.equal(agg.sessions[0].archived, true);
    assert.ok(agg.sessions[0].parseWarnings.includes(
      `archived parse v${PARSER_VERSION - 1}; source was pruned before current parser v${PARSER_VERSION} could re-read it`,
    ));
  } finally {
    _setCacheDbForTest(fileCacheDb);
    conn.close();
  }
});

test("scanSourceSessions marks Codex rollouts in archived_sessions as archived", () => {
  const active = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-codex-active-"));
  const archiveParent = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-codex-archive-"));
  const archive = path.join(archiveParent, "archived_sessions");
  fs.mkdirSync(archive);
  const writeCodex = (dir: string, id: string) => fs.writeFileSync(path.join(dir, `rollout-${id}.jsonl`), [
    { type: "session_meta", payload: { id, cwd: "/tmp/proj", source: "vscode" } },
    { type: "event_msg", payload: { type: "user_message", message: `work on ${id}` } },
    { type: "event_msg", payload: { type: "agent_message", message: "done" } },
  ].map((line) => JSON.stringify(line)).join("\n"), "utf8");

  writeCodex(active, "active");
  writeCodex(archive, "archived");
  const agg = scanSourceSessions({
    id: "codex",
    label: "Codex CLI + ChatGPT app",
    roots: [active, archive],
    format: "codex-sessions",
  }, 50, { includeArchived: true });

  assert.equal(agg.totalSessions, 2);
  assert.equal(agg.archivedSessions, 1);
  assert.equal(agg.sessions.find((s) => s.sessionId === "archived")?.archived, true);
  assert.equal(agg.sessions.find((s) => s.sessionId === "active")?.archived, undefined);
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
  assert.equal(s.numTurns, 1);
  assert.equal(s.metricSources.duration, "measured");
  assert.equal(s.metricSources.tokens, "missing"); // Hermes records no usage
  assert.ok(s.parseWarnings.includes("turn count inferred from user messages"));
  assert.equal(s.startedAt, Date.parse("2026-05-31T00:05:53.370621"));
});

test("collection model rollups sanitize local model paths and expose pricing evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-model-evidence-"));
  fs.writeFileSync(path.join(dir, "session.jsonl"), [
    { type: "system", sessionId: "local-model", timestamp: "2026-07-15T12:00:00.000Z" },
    { type: "assistant", message: {
      model: "/data/models/hf/zai-org__GLM-5.2-FP8",
      usage: { input_tokens: 1_000_000, output_tokens: 1_000 },
      content: [{ type: "text", text: "done" }],
    } },
  ].map((line) => JSON.stringify(line)).join("\n"), "utf8");

  const agg = scanSourceSessions({ id: "local", label: "Local", roots: [dir], format: "jsonl-dir" }, 50);
  assert.equal(agg.byModel[0].model, "hf:zai-org/glm-5.2-fp8");
  assert.equal((agg.byModel[0] as any).familyRateSessions, 1);
  assert.equal((agg.byModel[0] as any).listedRateSessions, 0);
  assert.equal((agg.usageSummary as any).sessionsWithPricedUsage, 1);
});

// ---- corpus-fingerprint memo (scanAllSources / collectAllSessions) ----

function writeSessionFile(dir: string, name: string, sessionId: string, extraText = "done"): void {
  fs.writeFileSync(
    path.join(dir, name),
    [
      { type: "system", sessionId, cwd: "/tmp/proj", timestamp: "2026-06-28T20:00:00.000Z" },
      { type: "assistant", message: { content: [{ type: "text", text: extraText }] } },
      { type: "result", duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } },
    ].map((l) => JSON.stringify(l)).join("\n"),
    "utf8",
  );
}

/** Hooks that mirror discoverKnownSources for one temp-dir source. */
function memoTestHooks(def: CollectionSourceDef, ttlMs: number, unknownDirs: string[] = []) {
  const discover = (): DiscoveredSource[] => {
    const collected = collectSourceFiles(defToSpec(def));
    let lastActivityMs: number | null = null;
    for (const f of collected.files) {
      if (lastActivityMs == null || f.mtime > lastActivityMs) lastActivityMs = f.mtime;
    }
    return [{
      id: def.id, label: def.label, format: def.format, parseable: def.parseable,
      roots: def.roots, presentRoots: def.roots,
      sessionCount: collected.files.length, lastActivityMs,
      status: collected.files.length > 0 ? "present" : "empty",
      collected,
    }];
  };
  const unknown = () => unknownDirs.map((dir) => ({
    dir, displayDir: dir, sampleFile: path.join(dir, "s.jsonl"), fileCount: 1, reason: "test",
  }));
  return { discover, sources: () => [def], unknown, fingerprintTtlMs: ttlMs };
}

test("scanAllSources memo serves cached parse while the corpus fingerprint is unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-memo-"));
  const def: CollectionSourceDef = { id: "memo-src", label: "Memo Src", roots: [dir], format: "jsonl-dir", parseable: true };
  writeSessionFile(dir, "a.jsonl", "memo-a");
  // Long TTL so only explicit `fresh` revalidates; the fingerprint check itself
  // is what these assertions target.
  const unknownDirs: string[] = [];
  _setCollectionHooksForTest(memoTestHooks(def, 60_000, unknownDirs));
  try {
    const r1 = scanAllSources(50);
    assert.equal(r1.totalParsedSessions, 1);
    assert.equal(r1.sessions[0].sessionId, "memo-a");

    // fresh → fingerprint revalidated; unchanged files → memoized objects served.
    const r2 = scanAllSources(50, { fresh: true });
    assert.equal(r2.totalParsedSessions, 1);
    assert.equal(r2.sessions[0], r1.sessions[0], "unchanged fingerprint must serve the memoized parse");

    // The shared full-history collection rides the same snapshot.
    const shared = collectAllSessions({ fresh: true });
    assert.equal(shared.length, 1);
    assert.equal(shared[0].sourceId, "memo-src");
    assert.equal(shared[0].sourceLabel, "Memo Src");
    assert.equal(collectAllSessions({ fresh: true })[0], shared[0]);
    assert.equal(buildRollup(shared).heatmapSessions, 1);

    // A fresh rescan with an unchanged corpus must still refresh the
    // unknown-candidate walk (its dirs live outside the fingerprint).
    unknownDirs.push("/tmp/new-agent");
    assert.equal(scanAllSources(50).unknown.length, 0, "non-fresh within TTL keeps the memoized unknown list");
    const r3 = scanAllSources(50, { fresh: true });
    assert.equal(r3.unknown.length, 1);
    assert.equal(r3.unknown[0].dir, "/tmp/new-agent");
    assert.equal(r3.sessions[0], r1.sessions[0], "parse memo must survive an unknown-only refresh");
  } finally {
    _setCollectionHooksForTest(null);
  }
});

test("scanAllSources memo invalidates when a session file is added or changes size", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-memo-inv-"));
  const def: CollectionSourceDef = { id: "memo-inv", label: "Memo Inv", roots: [dir], format: "jsonl-dir", parseable: true };
  writeSessionFile(dir, "a.jsonl", "inv-a");
  _setCollectionHooksForTest(memoTestHooks(def, 60_000));
  try {
    const r1 = scanAllSources(50);
    assert.equal(r1.totalParsedSessions, 1);

    // New file: within the TTL the memo is served stale (anti-stat-storm)…
    writeSessionFile(dir, "b.jsonl", "inv-b");
    assert.equal(scanAllSources(50).totalParsedSessions, 1);
    // …but fresh revalidates the fingerprint and recomputes.
    const r2 = scanAllSources(50, { fresh: true });
    assert.equal(r2.totalParsedSessions, 2);
    assert.equal(collectAllSessions().length, 2);

    // Same file, different content/size: fingerprint changes again.
    writeSessionFile(dir, "b.jsonl", "inv-b", "done with a longer final message");
    const r3 = scanAllSources(50, { fresh: true });
    assert.equal(r3.totalParsedSessions, 2);
    const b3 = r3.sessions.find((s) => s.sessionId === "inv-b");
    const b2 = r2.sessions.find((s) => s.sessionId === "inv-b");
    assert.ok(b3 && b2 && b3 !== b2, "changed file must be re-parsed, not served from the memo");
  } finally {
    _setCollectionHooksForTest(null);
  }
});

test("fingerprintDiscovery tracks file path, mtime, and size", () => {
  const base: DiscoveredSource = {
    id: "fp", label: "FP", format: "jsonl-dir", parseable: true,
    roots: ["/tmp/fp"], presentRoots: ["/tmp/fp"],
    sessionCount: 2, lastActivityMs: 2_000, status: "present",
    collected: {
      files: [
        { file: "/tmp/fp/a.jsonl", project: "p", mtime: 1_000, size: 10 },
        { file: "/tmp/fp/b.jsonl", project: "p", mtime: 2_000, size: 20 },
      ],
      scanWarnings: [],
    },
  };
  const clone = (mutate: (d: DiscoveredSource) => void): DiscoveredSource => {
    const d: DiscoveredSource = JSON.parse(JSON.stringify(base));
    mutate(d);
    return d;
  };
  const fp = fingerprintDiscovery([base]);
  assert.equal(fingerprintDiscovery([clone(() => {})]), fp, "identical discovery → identical fingerprint");
  // File order must not matter (walk order is fs-dependent).
  assert.equal(fingerprintDiscovery([clone((d) => d.collected!.files.reverse())]), fp);
  assert.notEqual(fingerprintDiscovery([clone((d) => { d.collected!.files[0].mtime = 1_001; })]), fp);
  assert.notEqual(fingerprintDiscovery([clone((d) => { d.collected!.files[0].size = 11; })]), fp);
  assert.notEqual(fingerprintDiscovery([clone((d) => { d.collected!.files[0].file = "/tmp/fp/renamed.jsonl"; })]), fp);
  assert.notEqual(fingerprintDiscovery([clone((d) => { d.collected!.files.pop(); d.sessionCount = 1; })]), fp);
});

// ---- limit-aware session retention ----

test("aggregate retains 100 sessions by default and honors sessionRetention above it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-retention-"));
  const COUNT = 160;
  for (let i = 0; i < COUNT; i++) writeSessionFile(dir, `s${String(i).padStart(3, "0")}.jsonl`, `ret-${i}`);
  const spec = { id: "retention", label: "Retention", roots: [dir], format: "jsonl-dir" as const };

  const capped = scanSourceSessions(spec, 100_000);
  assert.equal(capped.sessions.length, 100, "default display cap must stay 100 (the /live payload depends on it)");
  assert.equal(capped.totalSessions, COUNT, "totals must cover every session regardless of the display cap");

  const wide = scanSourceSessions(spec, 100_000, { sessionRetention: 10_000 });
  assert.equal(wide.sessions.length, COUNT, "sessionRetention above the corpus size must retain every session");

  // total* scalars must be identical in both — the cap is display-only.
  assert.equal(wide.totalSessions, capped.totalSessions);
  assert.equal(wide.totalCostUsd, capped.totalCostUsd);
  assert.equal(wide.totalInputTokens, capped.totalInputTokens);
  assert.equal(wide.totalOutputTokens, capped.totalOutputTokens);
  assert.equal(wide.totalToolCalls, capped.totalToolCalls);
  assert.equal(wide.sessionsWithInferredCost, capped.sessionsWithInferredCost);
  assert.deepEqual(wide.usageSummary, capped.usageSummary);
  // staleMs is wall-clock-derived and differs between the two scans — pin it.
  const normalize = (sessions: typeof capped.sessions) => sessions.map((s) => ({ ...s, staleMs: 0 }));
  assert.deepEqual(normalize(wide.sessions.slice(0, 100)), normalize(capped.sessions), "retained head must match the default-capped list");
});

test("scanAllSources serves more than 100 sessions per source when the limit asks for them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-retention-all-"));
  const COUNT = 130;
  for (let i = 0; i < COUNT; i++) writeSessionFile(dir, `s${String(i).padStart(3, "0")}.jsonl`, `retall-${i}`);
  const def: CollectionSourceDef = { id: "ret-all", label: "Ret All", roots: [dir], format: "jsonl-dir", parseable: true };
  _setCollectionHooksForTest(memoTestHooks(def, 60_000));
  try {
    const big = scanAllSources(2000);
    assert.equal(big.totalParsedSessions, COUNT);
    assert.equal(big.sessions.length, COUNT, "a large limit must not plateau at the old per-source cap of 100");

    const small = scanAllSources(50);
    assert.equal(small.sessions.length, 50, "the per-call limit still slices the memoized list down");
    assert.equal(small.totalParsedSessions, COUNT);
  } finally {
    _setCollectionHooksForTest(null);
  }
});

test("archived sessions are repriced from tokens instead of preserving stale cached estimates", () => {
  const Database = require("better-sqlite3");
  const { _setCacheDbForTest } = require("../lib/live-cache");
  const conn = new Database(":memory:");
  _setCacheDbForTest(conn);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-reprice-"));
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, [
      { type: "system", model: "gpt-5.4", sessionId: "repriced", timestamp: "2026-07-15T12:00:00.000Z" },
      { type: "assistant", message: {
        model: "gpt-5.4",
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
        content: [{ type: "text", text: "done" }],
      } },
    ].map((line) => JSON.stringify(line)).join("\n"), "utf8");
    const spec = { id: "repricing", label: "Repricing", roots: [dir], format: "jsonl-dir" as const };

    scanSourceSessions(spec, 50, { includeArchived: true });
    const row = conn.prepare("SELECT session_json FROM session_cache WHERE file = ?").get(file) as { session_json: string };
    const stale = JSON.parse(row.session_json);
    stale.costUsd = 999;
    stale.metricSources.cost = "inferred";
    conn.prepare("UPDATE session_cache SET session_json = ? WHERE file = ?").run(JSON.stringify(stale), file);
    fs.rmSync(file);

    const archived = scanSourceSessions(spec, 50, { includeArchived: true });
    assert.equal(archived.totalSessions, 1);
    assert.equal(archived.totalCostUsd, 17.5);
    assert.equal(archived.sessions[0].costUsd, 17.5);
  } finally {
    _setCacheDbForTest(fileCacheDb);
    conn.close();
  }
});
