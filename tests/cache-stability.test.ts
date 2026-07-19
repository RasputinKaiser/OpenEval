import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { cacheGet, cachePut, getCachedSessionRows, listCachedFilesUnder, listCachedSessionsUnder, PARSER_VERSION, _setCacheDbForTest } from "../lib/live-cache";
import { summarizeLiveSessionFile } from "../lib/live";

/**
 * Regression tests for the cache-stability fixes:
 *  - transient fs errors must not be cached as permanent null tombstones
 *  - torn/garbage cache rows must read as misses, never crash a consumer
 *  - a corrupt cache DB file must be recovered (renamed aside), not sticky-dead
 */

const conn = new Database(":memory:");
_setCacheDbForTest(conn);
after(() => {
  _setCacheDbForTest(null);
  conn.close();
});

const PLAUSIBLE = JSON.stringify({
  sessionId: "ok", metricSources: { cost: "missing" }, usageSegments: [], lastEventAt: 1_700_000_000_000,
});

test("transient fs error during parse is not cached as a null tombstone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-tombstone-"));
  try {
    const missing = path.join(dir, "vanished.jsonl");
    // knownStat skips the up-front statSync, so the parse itself hits ENOENT —
    // the shape of a file deleted between the walk and the open (or EMFILE).
    const s = summarizeLiveSessionFile(missing, "-p", 1_700_000_000_000, { stat: { mtimeMs: 123, size: 456 } });
    assert.equal(s, null);
    const cachedAfterFsError = cacheGet(missing, 123, 456);
    assert.equal(cachedAfterFsError.hit, false, "fs failure must stay retryable, not become a cached null");

    // Contrast: a genuinely unparseable file still caches its null (that IS
    // deterministic content, retrying cannot help).
    const malformed = path.join(dir, "malformed.jsonl");
    fs.writeFileSync(malformed, "null\n");
    const st = fs.statSync(malformed);
    assert.equal(summarizeLiveSessionFile(malformed, "-p", st.mtimeMs), null);
    const cachedTombstone = cacheGet(malformed, st.mtimeMs, st.size);
    assert.equal(cachedTombstone.hit, true);
    assert.equal(cachedTombstone.session, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("torn or garbage cache rows read as misses on every read path", () => {
  const insert = conn.prepare(
    "INSERT OR REPLACE INTO session_cache (file, mtime_ms, size, parser_version, session_json) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("/roots/x/torn.jsonl", 1, 2, PARSER_VERSION, '{"sessionId":"torn","metricSo');
  insert.run("/roots/x/garbage.jsonl", 1, 2, PARSER_VERSION, '{"totally":"unrelated"}');
  insert.run("/roots/x/valid.jsonl", 1, 2, PARSER_VERSION, PLAUSIBLE);

  assert.equal(cacheGet("/roots/x/torn.jsonl", 1, 2).hit, false);
  assert.equal(cacheGet("/roots/x/garbage.jsonl", 1, 2).hit, false);
  assert.equal(cacheGet("/roots/x/valid.jsonl", 1, 2).hit, true);

  // Path-only listing still surfaces every row (it never deserializes)…
  const files = listCachedFilesUnder(["/roots/x"]);
  assert.equal(files.length, 3);
  // …and hydration quietly drops the unusable ones.
  const rows = getCachedSessionRows(files);
  assert.deepEqual(rows.map((r) => r.session.sessionId), ["ok"]);
  assert.deepEqual(listCachedSessionsUnder(["/roots/x"]).map((r) => r.session.sessionId), ["ok"]);
});

test("corrupt cache DB file is renamed aside and rebuilt, not sticky-dead", () => {
  // CACHE_DB_PATH is fixed at module load from OPENEVAL_DATA_ROOT, so the
  // corruption flow needs its own process with its own scratch data root.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-corrupt-"));
  try {
    fs.mkdirSync(path.join(scratch, "data"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "data", "live-cache.db"), "this is not a sqlite database, not even close");
    const script = `
      const { cachePut, cacheGet } = require(${JSON.stringify(path.join(__dirname, "..", "lib", "live-cache.ts"))});
      const session = { sessionId: "recovered", metricSources: { cost: "missing" }, usageSegments: [], lastEventAt: 1 };
      cachePut("/r/a.jsonl", 1, 2, session);
      const hit = cacheGet("/r/a.jsonl", 1, 2);
      console.log(JSON.stringify({ hit: hit.hit, id: hit.session && hit.session.sessionId }));
    `;
    const out = execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, OPENEVAL_DATA_ROOT: scratch },
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(out.trim()), { hit: true, id: "recovered" });
    const names = fs.readdirSync(path.join(scratch, "data"));
    assert.ok(names.some((n) => n.startsWith("live-cache.db.corrupt-")), `corrupt file kept for forensics, got: ${names}`);
    assert.ok(names.includes("live-cache.db"), "fresh DB created in place");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
