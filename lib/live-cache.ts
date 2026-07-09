import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { ROOT } from "./config";
import type { LiveSession } from "./live";

/**
 * Persistent cache of parsed live sessions, keyed by (file, mtime, size).
 *
 * Session files are append-only and large (hundreds of MB); parsing the full
 * history cold takes ~20s and the in-memory cache dies with the process. This
 * SQLite cache survives restarts, so uncapped full-history scans (Collection
 * totals, the Timeline) are cheap after the first pass. The whole file is
 * disposable — deleting it just forces a re-parse.
 *
 * Bump PARSER_VERSION whenever parseLiveSession's output changes shape or
 * semantics; stale-version rows are ignored and overwritten.
 */
export const PARSER_VERSION = 4;

const CACHE_DB_PATH = path.join(ROOT, "data", "live-cache.db");

let db: Database.Database | null = null;
let dbFailed = false;

function getCacheDb(): Database.Database | null {
  if (db) return db;
  if (dbFailed) return null;
  try {
    fs.mkdirSync(path.dirname(CACHE_DB_PATH), { recursive: true });
    const conn = new Database(CACHE_DB_PATH, { timeout: 5_000 });
    conn.pragma("busy_timeout = 5000");
    try { conn.pragma("journal_mode = WAL"); } catch {}
    conn.pragma("synchronous = NORMAL");
    conn.exec(SCHEMA);
    db = conn;
    return conn;
  } catch {
    // No cache is a slowdown, never an error — scans still work uncached.
    dbFailed = true;
    return null;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_cache (
  file TEXT PRIMARY KEY,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  parser_version INTEGER NOT NULL,
  session_json TEXT
);
CREATE TABLE IF NOT EXISTS outcome_judgments (
  file TEXT PRIMARY KEY,
  session_id TEXT,
  mtime_ms REAL NOT NULL,
  score REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  judge TEXT NOT NULL,
  judged_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
  user_text, assistant_text, title,
  project UNINDEXED, source_id UNINDEXED, file UNINDEXED, at UNINDEXED
);
CREATE TABLE IF NOT EXISTS fts_meta (
  file TEXT PRIMARY KEY,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
`;

export function cacheGet(file: string, mtimeMs: number, size: number): { hit: boolean; session: LiveSession | null } {
  const conn = getCacheDb();
  if (!conn) return { hit: false, session: null };
  try {
    const row = conn
      .prepare("SELECT mtime_ms, size, parser_version, session_json FROM session_cache WHERE file = ?")
      .get(file) as { mtime_ms: number; size: number; parser_version: number; session_json: string | null } | undefined;
    if (!row || row.mtime_ms !== mtimeMs || row.size !== size || row.parser_version !== PARSER_VERSION) {
      return { hit: false, session: null };
    }
    if (row.session_json == null) return { hit: true, session: null };
    return { hit: true, session: JSON.parse(row.session_json) as LiveSession };
  } catch {
    return { hit: false, session: null };
  }
}

export function cachePut(file: string, mtimeMs: number, size: number, session: LiveSession | null): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    conn
      .prepare(
        `INSERT INTO session_cache (file, mtime_ms, size, parser_version, session_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
           parser_version = excluded.parser_version, session_json = excluded.session_json`,
      )
      .run(file, mtimeMs, size, PARSER_VERSION, session ? JSON.stringify(session) : null);
  } catch {
    // Best-effort; a failed write only costs a future re-parse.
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * Every cached parsed session under one of `prefixes` (expanded, absolute).
 * This is the ARCHIVE read path: harnesses prune their transcript dirs (Claude
 * Code keeps ~30 days), but cache rows are never deleted, so sessions survive
 * their files. parser_version is deliberately ignored — an old-version summary
 * of a deleted file can never be re-parsed, and stale beats gone.
 */
export function listCachedSessionsUnder(prefixes: string[]): Array<{ file: string; session: LiveSession }> {
  const conn = getCacheDb();
  if (!conn || prefixes.length === 0) return [];
  const out: Array<{ file: string; session: LiveSession }> = [];
  try {
    const where = prefixes.map(() => "file LIKE ? ESCAPE '\\'").join(" OR ");
    const args = prefixes.map((p) => escapeLike(p.replace(/\/+$/, "")) + "/%");
    const rows = conn
      .prepare(`SELECT file, session_json FROM session_cache WHERE session_json IS NOT NULL AND (${where})`)
      .all(...args) as Array<{ file: string; session_json: string }>;
    for (const r of rows) {
      try { out.push({ file: r.file, session: JSON.parse(r.session_json) as LiveSession }); } catch {}
    }
  } catch {}
  return out;
}

export interface StoredJudgment {
  file: string;
  sessionId: string | null;
  mtimeMs: number;
  score: number; // 0..1
  reasons: string[];
  judge: string; // "harness/model" that produced it
  judgedAt: number;
}

/** All persisted LLM-judge outcome scores, keyed by session file. */
export function loadJudgments(): Map<string, StoredJudgment> {
  const out = new Map<string, StoredJudgment>();
  const conn = getCacheDb();
  if (!conn) return out;
  try {
    const rows = conn.prepare("SELECT * FROM outcome_judgments").all() as Array<{
      file: string; session_id: string | null; mtime_ms: number; score: number;
      reasons_json: string; judge: string; judged_at: number;
    }>;
    for (const r of rows) {
      let reasons: string[] = [];
      try { reasons = JSON.parse(r.reasons_json); } catch {}
      out.set(r.file, {
        file: r.file,
        sessionId: r.session_id,
        mtimeMs: r.mtime_ms,
        score: r.score,
        reasons,
        judge: r.judge,
        judgedAt: r.judged_at,
      });
    }
  } catch {}
  return out;
}

export function saveJudgment(j: StoredJudgment): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    conn
      .prepare(
        `INSERT INTO outcome_judgments (file, session_id, mtime_ms, score, reasons_json, judge, judged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file) DO UPDATE SET session_id = excluded.session_id, mtime_ms = excluded.mtime_ms,
           score = excluded.score, reasons_json = excluded.reasons_json, judge = excluded.judge,
           judged_at = excluded.judged_at`,
      )
      .run(j.file, j.sessionId, j.mtimeMs, j.score, JSON.stringify(j.reasons), j.judge, j.judgedAt);
  } catch {}
}

// ---------- Full-text search (FTS5) over transcript text ----------

export interface FtsDoc {
  file: string;
  sourceId: string;
  project: string;
  title: string;
  at: number; // ms — session recency for display/sort
  userText: string;
  assistantText: string;
}

export interface FtsHit {
  file: string;
  sourceId: string;
  project: string;
  title: string;
  at: number;
  snippet: string;
}

/** Files already indexed, with the mtime+size they were indexed at (staleness check). */
export function ftsIndexedFiles(): Map<string, { mtimeMs: number; size: number }> {
  const out = new Map<string, { mtimeMs: number; size: number }>();
  const conn = getCacheDb();
  if (!conn) return out;
  try {
    for (const r of conn.prepare("SELECT file, mtime_ms, size FROM fts_meta").all() as Array<{ file: string; mtime_ms: number; size: number }>) {
      out.set(r.file, { mtimeMs: r.mtime_ms, size: r.size });
    }
  } catch {}
  return out;
}

/** (Re-)index one file's extracted text. Replaces any previous rows for the file. */
export function ftsUpsert(doc: FtsDoc, mtimeMs: number, size: number): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    const tx = conn.transaction(() => {
      conn.prepare("DELETE FROM session_fts WHERE file = ?").run(doc.file);
      conn
        .prepare("INSERT INTO session_fts (user_text, assistant_text, title, project, source_id, file, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(doc.userText, doc.assistantText, doc.title, doc.project, doc.sourceId, doc.file, doc.at);
      conn
        .prepare(
          `INSERT INTO fts_meta (file, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size, indexed_at = excluded.indexed_at`,
        )
        .run(doc.file, mtimeMs, size, Date.now());
    });
    tx();
  } catch {}
}

/**
 * Escape a raw user query into FTS5 MATCH syntax: each whitespace token becomes
 * a quoted string (AND semantics); a trailing * keeps prefix-match behavior.
 * Raw MATCH syntax is never passed through — odd characters in a query must
 * not be able to crash the search.
 */
export function toFtsMatch(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const prefix = tok.endsWith("*") && tok.length > 1;
      const body = (prefix ? tok.slice(0, -1) : tok).replace(/"/g, '""');
      return `"${body}"${prefix ? "*" : ""}`;
    })
    .join(" ");
}

export function ftsSearch(q: string, limit = 50): FtsHit[] {
  const conn = getCacheDb();
  const match = toFtsMatch(q);
  if (!conn || !match) return [];
  try {
    const rows = conn
      .prepare(
        `SELECT file, source_id, project, title, at,
                snippet(session_fts, 0, '«', '»', ' … ', 14) AS snip_user,
                snippet(session_fts, 1, '«', '»', ' … ', 14) AS snip_assistant
         FROM session_fts WHERE session_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, Math.max(1, Math.min(limit, 200))) as Array<{
      file: string; source_id: string; project: string; title: string; at: number;
      snip_user: string; snip_assistant: string;
    }>;
    return rows.map((r) => ({
      file: r.file,
      sourceId: r.source_id,
      project: r.project,
      title: r.title,
      at: Number(r.at) || 0,
      // Prefer whichever side actually matched (has highlight marks).
      snippet: r.snip_user.includes("«") ? r.snip_user : r.snip_assistant || r.snip_user,
    }));
  } catch {
    return [];
  }
}

/** Test hook: point the cache at a scratch connection (schema applied), or reset with null. */
export function _setCacheDbForTest(conn: Database.Database | null): void {
  if (conn) conn.exec(SCHEMA);
  db = conn;
  dbFailed = false;
}
