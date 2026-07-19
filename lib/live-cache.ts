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
export const PARSER_VERSION = 18; // v18: reject placeholder model ids everywhere; v17: distinct Codex/Claude child identities and cost-allocation provenance

/** Bump whenever transcript-to-search text extraction semantics change. */
export const FTS_INDEX_VERSION = 2; // v2: source-aware Codex echo suppression and IDE-context normalization

const CACHE_DB_PATH = path.join(ROOT, "data", "live-cache.db");

let db: Database.Database | null = null;
let dbFailed = false;
let triedCorruptionRecovery = false;

// better-sqlite3 has no implicit statement cache, so per-call conn.prepare()
// recompiles the SQL — measured at 2.5× the cost of the actual point lookup
// across a full scan. Statements are owned by their connection: the cache
// resets whenever the handle changes (corruption recovery, test-hook swap).
let stmtOwner: Database.Database | null = null;
let stmtCache = new Map<string, Database.Statement>();

function stmt(conn: Database.Database, sql: string): Database.Statement {
  if (stmtOwner !== conn) {
    stmtOwner = conn;
    stmtCache = new Map();
  }
  let s = stmtCache.get(sql);
  if (!s) {
    s = conn.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

function openCacheDb(): Database.Database {
  fs.mkdirSync(path.dirname(CACHE_DB_PATH), { recursive: true });
  const conn = new Database(CACHE_DB_PATH, { timeout: 5_000 });
  conn.pragma("busy_timeout = 5000");
  try { conn.pragma("journal_mode = WAL"); } catch {}
  conn.pragma("synchronous = NORMAL");
  conn.exec(SCHEMA);
  // Additive migration for DBs created before prompt versioning existed.
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN prompt_version INTEGER"); } catch {}
  // Permanent means the SESSION itself is unjudgeable (missing file or no
  // conversational text). Backend outages remain retryable after recovery.
  try { conn.exec("ALTER TABLE judge_failures ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0"); } catch {}
  // Additive migration: remember each file's fts rowid so re-indexing can
  // delete by rowid instead of scanning the UNINDEXED `file` column.
  try { conn.exec("ALTER TABLE fts_meta ADD COLUMN fts_rowid INTEGER"); } catch {}
  // Text extraction evolves independently from the live-session parser.
  // Old rows must be offered to the explicit indexer again after a change.
  try { conn.exec("ALTER TABLE fts_meta ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0"); } catch {}
  return conn;
}

function getCacheDb(): Database.Database | null {
  if (db) return db;
  if (dbFailed) return null;
  try {
    db = openCacheDb();
    return db;
  } catch (e) {
    // A corrupt cache file used to leave the process cache-less until someone
    // deleted it by hand (dbFailed is sticky). The whole file is disposable —
    // move it aside for forensics and start fresh, once.
    const code = (e as { code?: unknown })?.code;
    if ((code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") && !triedCorruptionRecovery) {
      triedCorruptionRecovery = true;
      try {
        const suffix = `.corrupt-${Date.now()}`;
        fs.renameSync(CACHE_DB_PATH, CACHE_DB_PATH + suffix);
        // WAL/SHM siblings belong to the corrupt file; a fresh DB must not inherit them.
        for (const ext of ["-wal", "-shm"]) {
          try { fs.renameSync(CACHE_DB_PATH + ext, CACHE_DB_PATH + ext + suffix); } catch {}
        }
        db = openCacheDb();
        return db;
      } catch {}
    }
    // No cache is a slowdown, never an error — scans still work uncached.
    dbFailed = true;
    return null;
  }
}

/**
 * Gate for session rows deserialized from disk: a torn or garbage row must
 * read as a cache miss, never as a crash in whoever dereferences the session.
 * Checks only the containers downstream code dereferences unconditionally
 * (refreshInferredSessionCost, appendArchivedSessions, aggregate).
 */
function isPlausibleCachedSession(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false;
  const c = s as Record<string, unknown>;
  if (typeof c.metricSources !== "object" || c.metricSources === null) return false;
  if (!Array.isArray(c.usageSegments)) return false;
  if (typeof c.lastEventAt !== "number") return false;
  if (c.modelUsage != null && !Array.isArray(c.modelUsage)) return false;
  return true;
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
  judged_at INTEGER NOT NULL,
  prompt_version INTEGER
);
CREATE TABLE IF NOT EXISTS judge_failures (
  file TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  last_attempt_at INTEGER NOT NULL,
  permanent INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
  user_text, assistant_text, title,
  project UNINDEXED, source_id UNINDEXED, file UNINDEXED, at UNINDEXED
);
CREATE TABLE IF NOT EXISTS fts_meta (
  file TEXT PRIMARY KEY,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  fts_rowid INTEGER,
  index_version INTEGER NOT NULL DEFAULT 0
);
`;

export function cacheGet(file: string, mtimeMs: number, size: number): { hit: boolean; session: LiveSession | null } {
  const conn = getCacheDb();
  if (!conn) return { hit: false, session: null };
  try {
    const row = stmt(conn, "SELECT mtime_ms, size, parser_version, session_json FROM session_cache WHERE file = ?")
      .get(file) as { mtime_ms: number; size: number; parser_version: number; session_json: string | null } | undefined;
    if (!row || row.mtime_ms !== mtimeMs || row.size !== size || row.parser_version !== PARSER_VERSION) {
      return { hit: false, session: null };
    }
    if (row.session_json == null) return { hit: true, session: null };
    const session = JSON.parse(row.session_json) as LiveSession;
    if (!isPlausibleCachedSession(session)) return { hit: false, session: null };
    return { hit: true, session };
  } catch {
    return { hit: false, session: null };
  }
}

export function cachePut(file: string, mtimeMs: number, size: number, session: LiveSession | null): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    stmt(
      conn,
      `INSERT INTO session_cache (file, mtime_ms, size, parser_version, session_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
         parser_version = excluded.parser_version, session_json = excluded.session_json`,
    ).run(file, mtimeMs, size, PARSER_VERSION, session ? JSON.stringify(session) : null);
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
export function listCachedSessionsUnder(prefixes: string[]): Array<{ file: string; session: LiveSession; parserVersion: number }> {
  const conn = getCacheDb();
  if (!conn || prefixes.length === 0) return [];
  const out: Array<{ file: string; session: LiveSession; parserVersion: number }> = [];
  try {
    const where = prefixes.map(() => "file LIKE ? ESCAPE '\\'").join(" OR ");
    const args = prefixes.map((p) => escapeLike(p.replace(/\/+$/, "")) + "/%");
    const rows = conn
      .prepare(`SELECT file, session_json, parser_version FROM session_cache WHERE session_json IS NOT NULL AND (${where})`)
      .all(...args) as Array<{ file: string; session_json: string; parser_version: number }>;
    for (const r of rows) {
      try {
        const session = JSON.parse(r.session_json) as LiveSession;
        if (isPlausibleCachedSession(session)) out.push({ file: r.file, session, parserVersion: r.parser_version });
      } catch {}
    }
  } catch {}
  return out;
}

/**
 * File paths (only) of every cached parsed session under `prefixes`. `file` is
 * the first column of the row, so SQLite answers without touching the
 * session_json overflow pages — measured 2.8ms vs 469ms for the full-JSON
 * variant on a 1,700-row cache. Pair with getCachedSessionRows to hydrate just
 * the survivors of a cheap filter (the archived-session merge keeps ~3%).
 */
export function listCachedFilesUnder(prefixes: string[]): string[] {
  const conn = getCacheDb();
  if (!conn || prefixes.length === 0) return [];
  try {
    const where = prefixes.map(() => "file LIKE ? ESCAPE '\\'").join(" OR ");
    const args = prefixes.map((p) => escapeLike(p.replace(/\/+$/, "")) + "/%");
    const rows = conn
      .prepare(`SELECT file FROM session_cache WHERE session_json IS NOT NULL AND (${where})`)
      .all(...args) as Array<{ file: string }>;
    return rows.map((r) => r.file);
  } catch {
    return [];
  }
}

/** Hydrate specific cached sessions by primary key (post-filter companion to listCachedFilesUnder). */
export function getCachedSessionRows(files: string[]): Array<{ file: string; session: LiveSession; parserVersion: number }> {
  const conn = getCacheDb();
  if (!conn || files.length === 0) return [];
  const out: Array<{ file: string; session: LiveSession; parserVersion: number }> = [];
  for (const file of files) {
    try {
      const row = stmt(conn, "SELECT session_json, parser_version FROM session_cache WHERE file = ?")
        .get(file) as { session_json: string | null; parser_version: number } | undefined;
      if (!row || row.session_json == null) continue;
      const session = JSON.parse(row.session_json) as LiveSession;
      if (isPlausibleCachedSession(session)) out.push({ file, session, parserVersion: row.parser_version });
    } catch {}
  }
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
  /** JUDGE_PROMPT_VERSION the verdict was produced under (null = pre-versioning). */
  promptVersion?: number | null;
}

/** All persisted LLM-judge outcome scores, keyed by session file. */
export function loadJudgments(): Map<string, StoredJudgment> {
  const out = new Map<string, StoredJudgment>();
  const conn = getCacheDb();
  if (!conn) return out;
  try {
    const rows = conn.prepare("SELECT * FROM outcome_judgments").all() as Array<{
      file: string; session_id: string | null; mtime_ms: number; score: number;
      reasons_json: string; judge: string; judged_at: number; prompt_version: number | null;
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
        promptVersion: r.prompt_version ?? null,
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
        `INSERT INTO outcome_judgments (file, session_id, mtime_ms, score, reasons_json, judge, judged_at, prompt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file) DO UPDATE SET session_id = excluded.session_id, mtime_ms = excluded.mtime_ms,
           score = excluded.score, reasons_json = excluded.reasons_json, judge = excluded.judge,
           judged_at = excluded.judged_at, prompt_version = excluded.prompt_version`,
      )
      .run(j.file, j.sessionId, j.mtimeMs, j.score, JSON.stringify(j.reasons), j.judge, j.judgedAt, j.promptVersion ?? null);
  } catch {}
}

// ---------- Judge failure ledger ----------

/** After this many failed attempts a file is skipped by future judge passes. */
export const MAX_JUDGE_ATTEMPTS = 3;

export interface JudgeFailure {
  file: string;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number;
  permanent: boolean;
}

/**
 * Failed judge attempts, keyed by session file. Without this ledger, a file
 * that can never be judged (deleted, unparseable, or a judge-killing prompt)
 * is retried on EVERY pass and judge-all never converges.
 */
export function loadJudgeFailures(): Map<string, JudgeFailure> {
  const out = new Map<string, JudgeFailure>();
  const conn = getCacheDb();
  if (!conn) return out;
  try {
    const rows = conn.prepare("SELECT * FROM judge_failures").all() as Array<{
      file: string; attempts: number; last_error: string | null; last_attempt_at: number; permanent: number;
    }>;
    for (const r of rows) {
      out.set(r.file, {
        file: r.file,
        attempts: r.attempts,
        lastError: r.last_error,
        lastAttemptAt: r.last_attempt_at,
        permanent: !!r.permanent,
      });
    }
  } catch {}
  return out;
}

export function recordJudgeFailure(file: string, error: string, opts: { permanent?: boolean } = {}): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    const bump = opts.permanent ? MAX_JUDGE_ATTEMPTS : 1;
    conn
      .prepare(
        `INSERT INTO judge_failures (file, attempts, last_error, last_attempt_at, permanent) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file) DO UPDATE SET attempts = judge_failures.attempts + ${bump},
           last_error = excluded.last_error, last_attempt_at = excluded.last_attempt_at,
           permanent = MAX(judge_failures.permanent, excluded.permanent)`,
      )
      .run(file, bump, error.slice(0, 300), Date.now(), opts.permanent ? 1 : 0);
  } catch {}
}

/** A successful judgment wipes the failure history (transient errors resolved). */
export function clearJudgeFailure(file: string): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    conn.prepare("DELETE FROM judge_failures WHERE file = ?").run(file);
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
    for (const r of conn.prepare("SELECT file, mtime_ms, size FROM fts_meta WHERE index_version = ?").all(FTS_INDEX_VERSION) as Array<{ file: string; mtime_ms: number; size: number }>) {
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
      // `file` is UNINDEXED in the fts5 table, so DELETE … WHERE file = ? is a
      // full-table scan (O(N²) across an index build). Delete by the rowid
      // remembered in fts_meta; scan only for rows indexed before fts_rowid
      // existed. No fts_meta row means nothing was indexed — skip the delete.
      const prev = conn.prepare("SELECT fts_rowid FROM fts_meta WHERE file = ?").get(doc.file) as
        | { fts_rowid: number | null }
        | undefined;
      if (prev?.fts_rowid != null) conn.prepare("DELETE FROM session_fts WHERE rowid = ?").run(prev.fts_rowid);
      else if (prev) conn.prepare("DELETE FROM session_fts WHERE file = ?").run(doc.file);
      const inserted = conn
        .prepare("INSERT INTO session_fts (user_text, assistant_text, title, project, source_id, file, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(doc.userText, doc.assistantText, doc.title, doc.project, doc.sourceId, doc.file, doc.at);
      conn
        .prepare(
          `INSERT INTO fts_meta (file, mtime_ms, size, indexed_at, fts_rowid, index_version) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
             indexed_at = excluded.indexed_at, fts_rowid = excluded.fts_rowid,
             index_version = excluded.index_version`,
        )
        .run(doc.file, mtimeMs, size, Date.now(), Number(inserted.lastInsertRowid), FTS_INDEX_VERSION);
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
  triedCorruptionRecovery = false;
  // Cached statements belong to the previous connection; stmt() would reset
  // lazily on owner mismatch, but dropping them now releases the old handles.
  stmtOwner = null;
  stmtCache = new Map();
}
