import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cacheGet, cachePut, loadJudgments, saveJudgment, listCachedSessionsUnder, ftsUpsert, ftsSearch, ftsIndexedFiles, toFtsMatch, PARSER_VERSION, _setCacheDbForTest } from "../lib/live-cache";
import type { LiveSession } from "../lib/live";

function withMemoryDb(fn: () => void) {
  const conn = new Database(":memory:");
  _setCacheDbForTest(conn);
  try {
    fn();
  } finally {
    _setCacheDbForTest(null);
    conn.close();
  }
}

const fakeSession = { sessionId: "s1", inputTokens: 42, outputTokens: 7 } as unknown as LiveSession;

test("live-cache: put/get round-trips a session keyed by mtime+size", () => {
  withMemoryDb(() => {
    assert.equal(cacheGet("/a.jsonl", 100, 5).hit, false);
    cachePut("/a.jsonl", 100, 5, fakeSession);
    const hit = cacheGet("/a.jsonl", 100, 5);
    assert.equal(hit.hit, true);
    assert.equal(hit.session?.sessionId, "s1");
    assert.equal(hit.session?.inputTokens, 42);
    // Changed file → miss.
    assert.equal(cacheGet("/a.jsonl", 101, 5).hit, false);
    assert.equal(cacheGet("/a.jsonl", 100, 6).hit, false);
  });
});

test("live-cache: caches null parses (unparseable files are not re-parsed)", () => {
  withMemoryDb(() => {
    cachePut("/bad.jsonl", 50, 9, null);
    const hit = cacheGet("/bad.jsonl", 50, 9);
    assert.equal(hit.hit, true);
    assert.equal(hit.session, null);
  });
});

test("live-cache: a parser-version bump invalidates old rows", () => {
  withMemoryDb(() => {
    const conn = new Database(":memory:");
    _setCacheDbForTest(conn);
    conn
      .prepare("INSERT INTO session_cache (file, mtime_ms, size, parser_version, session_json) VALUES (?, ?, ?, ?, ?)")
      .run("/old.jsonl", 10, 2, PARSER_VERSION - 1, JSON.stringify(fakeSession));
    assert.equal(cacheGet("/old.jsonl", 10, 2).hit, false);
    conn.close();
  });
});

test("live-cache: judgments round-trip and upsert", () => {
  withMemoryDb(() => {
    saveJudgment({ file: "/a.jsonl", sessionId: "s1", mtimeMs: 1, score: 0.8, reasons: ["done"], judge: "codex", judgedAt: 123 });
    saveJudgment({ file: "/a.jsonl", sessionId: "s1", mtimeMs: 2, score: 0.4, reasons: ["revised"], judge: "codex", judgedAt: 456 });
    const all = loadJudgments();
    assert.equal(all.size, 1);
    const j = all.get("/a.jsonl")!;
    assert.equal(j.score, 0.4);
    assert.deepEqual(j.reasons, ["revised"]);
    assert.equal(j.judgedAt, 456);
  });
});

test("live-cache: listCachedSessionsUnder filters by root prefix", () => {
  withMemoryDb(() => {
    cachePut("/roots/a/s1.jsonl", 1, 1, { ...fakeSession, sessionId: "a1" } as never);
    cachePut("/roots/b/s2.jsonl", 1, 1, { ...fakeSession, sessionId: "b1" } as never);
    cachePut("/roots/a-sibling/s3.jsonl", 1, 1, { ...fakeSession, sessionId: "c1" } as never);
    const under = listCachedSessionsUnder(["/roots/a"]);
    assert.deepEqual(under.map((u) => u.session.sessionId), ["a1"]);
    assert.deepEqual(under.map((u) => u.parserVersion), [PARSER_VERSION]);
    // Both roots at once.
    assert.equal(listCachedSessionsUnder(["/roots/a", "/roots/b"]).length, 2);
    // Null parses are never returned.
    cachePut("/roots/a/bad.jsonl", 1, 1, null);
    assert.equal(listCachedSessionsUnder(["/roots/a"]).length, 1);
  });
});

test("live-cache: ftsUpsert deletes by remembered rowid and still replaces legacy rows", () => {
  withMemoryDb(() => {
    const conn = new Database(":memory:");
    _setCacheDbForTest(conn);
    // Legacy state: fts row + fts_meta row indexed before fts_rowid existed.
    conn
      .prepare("INSERT INTO session_fts (user_text, assistant_text, title, project, source_id, file, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("legacy text", "", "t", "/p", "src", "/legacy.jsonl", 1);
    conn.prepare("INSERT INTO fts_meta (file, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?)").run("/legacy.jsonl", 1, 1, 1);
    assert.equal(ftsSearch("legacy")[0]?.file, "/legacy.jsonl");

    // Re-index replaces the legacy row via the file-scan fallback and records the rowid.
    ftsUpsert({ file: "/legacy.jsonl", sourceId: "src", project: "/p", title: "t", at: 2, userText: "fresh text", assistantText: "" }, 2, 2);
    assert.equal(ftsSearch("legacy").length, 0);
    assert.equal(ftsSearch("fresh")[0]?.file, "/legacy.jsonl");
    const meta = conn.prepare("SELECT fts_rowid FROM fts_meta WHERE file = ?").get("/legacy.jsonl") as { fts_rowid: number | null };
    assert.ok(meta.fts_rowid != null);

    // The next re-index goes through the rowid delete and must not duplicate.
    ftsUpsert({ file: "/legacy.jsonl", sourceId: "src", project: "/p", title: "t", at: 3, userText: "third pass", assistantText: "" }, 3, 3);
    assert.equal(ftsSearch("fresh").length, 0);
    assert.equal(ftsSearch("third")[0]?.file, "/legacy.jsonl");
    const count = conn.prepare("SELECT count(*) AS n FROM session_fts").get() as { n: number };
    assert.equal(count.n, 1);
    conn.close();
  });
});

test("live-cache: FTS freshness ignores rows from an older extraction contract", () => {
  withMemoryDb(() => {
    const conn = new Database(":memory:");
    _setCacheDbForTest(conn);
    conn
      .prepare("INSERT INTO session_fts (user_text, assistant_text, title, project, source_id, file, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("stale text", "", "t", "/p", "src", "/stale.jsonl", 1);
    conn.prepare("INSERT INTO fts_meta (file, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?)").run("/stale.jsonl", 10, 20, 1);

    assert.equal(ftsIndexedFiles().has("/stale.jsonl"), false);
    conn.close();
  });
});

test("live-cache: FTS index round-trips, replaces on re-index, and survives odd queries", () => {
  withMemoryDb(() => {
    ftsUpsert(
      { file: "/s/a.jsonl", sourceId: "claude-code", project: "/p", title: "fix auth", at: 111, userText: "please fix the auth refactor bug", assistantText: "patched the token validation" },
      1, 10,
    );
    ftsUpsert(
      { file: "/s/b.jsonl", sourceId: "codex", project: "/q", title: "css", at: 222, userText: "center the div", assistantText: "used flexbox" },
      1, 10,
    );
    const hits = ftsSearch("auth refactor");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, "/s/a.jsonl");
    assert.ok(hits[0].snippet.includes("«auth»"));
    // Assistant-side matches are found too.
    assert.equal(ftsSearch("flexbox")[0]?.file, "/s/b.jsonl");
    // Re-index replaces, not duplicates.
    ftsUpsert({ file: "/s/a.jsonl", sourceId: "claude-code", project: "/p", title: "fix auth", at: 111, userText: "totally different now", assistantText: "" }, 2, 11);
    assert.equal(ftsSearch("auth refactor").length, 0);
    assert.equal(ftsSearch("totally different").length, 1);
    assert.deepEqual(ftsIndexedFiles().get("/s/a.jsonl"), { mtimeMs: 2, size: 11 });
    // FTS5 syntax characters must not throw.
    assert.deepEqual(ftsSearch('c++ "quote OR (NEAR'), []);
    // Embedded quotes are doubled, then the token is wrapped: "b" → """b""".
    assert.equal(toFtsMatch('a "b" c*'), '"a" """b""" "c"*');
  });
});
