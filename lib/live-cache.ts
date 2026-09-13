import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { ROOT } from "./config";
import type { LiveSession } from "./live";
import type { JudgeSelection } from "./grader/selection";

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
export const PARSER_VERSION = 25; // v25: lossless compound windows, full transcript text, native agent source projections

/** Bump whenever transcript-to-search text extraction semantics change. */
export const FTS_INDEX_VERSION = 6; // v6: bounded reasoning/thinking evidence plus source-aware pending invalidation

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
  // Bound sidecar growth without forcing fsync-per-row. The auto-checkpoint
  // threshold is pages (~4 MiB at SQLite's default 4 KiB page size); the
  // journal limit keeps a reset WAL from lingering as a large sparse file.
  conn.pragma("wal_autocheckpoint = 1000");
  conn.pragma("journal_size_limit = 8388608");
  conn.exec(SCHEMA);
  // Additive migration: pre-v20 rows only keyed by file/stat. Their empty
  // context is a safe one-time miss for context-aware reads and is overwritten
  // after the first re-parse; no destructive table rebuild is needed.
  try { conn.exec("ALTER TABLE session_cache ADD COLUMN context_key TEXT NOT NULL DEFAULT ''"); } catch {}
  // Additive migration for DBs created before prompt versioning existed.
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN prompt_version INTEGER"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN selection_json TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN evidence_digest TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN evidence_version TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN revision TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN source_id TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN verdict_status TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN confidence TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN evidence_ids_json TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN contradiction_ids_json TEXT"); } catch {}
  try { conn.exec("ALTER TABLE outcome_judgments ADD COLUMN dimensions_json TEXT"); } catch {}
  try { conn.exec("ALTER TABLE judge_jobs ADD COLUMN selection_json TEXT"); } catch {}
  // Permanent means the SESSION itself is unjudgeable (missing file or no
  // conversational text). Backend failures remain retryable until the
  // bounded MAX_JUDGE_ATTEMPTS threshold is reached.
  try { conn.exec("ALTER TABLE judge_failures ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0"); } catch {}
  // Additive migration: remember each file's fts rowid so re-indexing can
  // delete by rowid instead of scanning the UNINDEXED `file` column.
  try { conn.exec("ALTER TABLE fts_meta ADD COLUMN fts_rowid INTEGER"); } catch {}
  // Text extraction evolves independently from the live-session parser.
  // Old rows must be offered to the explicit indexer again after a change.
  try { conn.exec("ALTER TABLE fts_meta ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0"); } catch {}
  // Same-stat transcript rewrites are possible when a writer restores mtime
  // or replaces content without changing its byte length. The search index
  // keeps a bounded head/tail fingerprint so those rewrites are re-indexed.
  try { conn.exec("ALTER TABLE fts_meta ADD COLUMN content_fingerprint TEXT NOT NULL DEFAULT ''"); } catch {}
  // Source provenance is part of the search identity. Re-index legacy rows
  // whose source_id is empty when the current registry supplies a source.
  try { conn.exec("ALTER TABLE fts_meta ADD COLUMN source_id TEXT NOT NULL DEFAULT ''"); } catch {}
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
  context_key TEXT NOT NULL DEFAULT '',
  session_json TEXT
);
CREATE TABLE IF NOT EXISTS outcome_judgments (
  file TEXT PRIMARY KEY,
  session_id TEXT,
  mtime_ms REAL NOT NULL,
  score REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  judge TEXT NOT NULL,
  selection_json TEXT,
  judged_at INTEGER NOT NULL,
  prompt_version INTEGER,
  evidence_digest TEXT,
  evidence_version TEXT,
  revision TEXT,
  source_id TEXT,
  verdict_status TEXT,
  confidence TEXT,
  evidence_ids_json TEXT,
  contradiction_ids_json TEXT,
  dimensions_json TEXT
);
CREATE TABLE IF NOT EXISTS judge_receipts (
  receipt_id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  source_id TEXT,
  session_id TEXT,
  revision TEXT NOT NULL,
  evidence_digest TEXT,
  evidence_version TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  verdict_status TEXT NOT NULL,
  score REAL,
  confidence TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  contradiction_ids_json TEXT NOT NULL,
  dimensions_json TEXT,
  judge TEXT NOT NULL,
  selection_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS judge_receipts_file_idx ON judge_receipts(file, created_at);
CREATE TABLE IF NOT EXISTS judge_legacy_history (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  judged_at INTEGER NOT NULL,
  archived_at INTEGER NOT NULL,
  judgment_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS judge_legacy_history_file_idx ON judge_legacy_history(file, archived_at, history_id);
CREATE TABLE IF NOT EXISTS judge_failures (
  file TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  last_attempt_at INTEGER NOT NULL,
  permanent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS judge_jobs (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  state TEXT NOT NULL,
  total INTEGER NOT NULL,
  done INTEGER NOT NULL,
  judged INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  judge TEXT NOT NULL,
  selection_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  last_error TEXT,
  queue_json TEXT NOT NULL,
  lease_id TEXT,
  owner_pid INTEGER,
  heartbeat_at INTEGER
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
  index_version INTEGER NOT NULL DEFAULT 0,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT ''
);
`;

export function cacheGet(file: string, mtimeMs: number, size: number, contextKey = ""): { hit: boolean; session: LiveSession | null } {
  const conn = getCacheDb();
  if (!conn) return { hit: false, session: null };
  try {
    const row = stmt(conn, "SELECT mtime_ms, size, parser_version, context_key, session_json FROM session_cache WHERE file = ?")
      .get(file) as { mtime_ms: number; size: number; parser_version: number; context_key: string | null; session_json: string | null } | undefined;
    // An omitted context preserves the pre-v20 helper's legacy wildcard
    // behavior for direct callers/tests. Parser call sites always provide a
    // non-empty context and therefore enforce the full identity.
    if (!row || row.mtime_ms !== mtimeMs || row.size !== size || row.parser_version !== PARSER_VERSION || (contextKey !== "" && (row.context_key ?? "") !== contextKey)) {
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

export function cachePut(file: string, mtimeMs: number, size: number, session: LiveSession | null, contextKey = ""): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    stmt(
      conn,
      `INSERT INTO session_cache (file, mtime_ms, size, parser_version, context_key, session_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
         parser_version = excluded.parser_version, context_key = excluded.context_key, session_json = excluded.session_json
       WHERE session_cache.mtime_ms IS NOT excluded.mtime_ms
          OR session_cache.size IS NOT excluded.size
          OR session_cache.parser_version IS NOT excluded.parser_version
          OR session_cache.context_key IS NOT excluded.context_key
          OR session_cache.session_json IS NOT excluded.session_json`,
    ).run(file, mtimeMs, size, PARSER_VERSION, contextKey, session ? JSON.stringify(session) : null);
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
  selection?: JudgeSelection;
  /** Current packet identity used by the v4 evidence judge. */
  evidenceDigest?: string | null;
  evidenceVersion?: string | null;
  revision?: string | null;
  sourceId?: string | null;
  verdictStatus?: "achieved" | "partial" | "not_achieved" | "insufficient_evidence";
  confidence?: "high" | "medium" | "low";
  evidenceIds?: string[];
  contradictionEvidenceIds?: string[];
  dimensions?: Record<string, unknown>;
}

export interface StoredJudgeReceipt {
  receiptId: string;
  file: string;
  sourceId: string | null;
  sessionId: string | null;
  revision: string;
  evidenceDigest: string | null;
  evidenceVersion: string;
  promptVersion: number;
  outcome: "achieved" | "partial" | "not_achieved" | "insufficient_evidence";
  /** Compatibility alias for queue/status consumers written against v3. */
  status?: "achieved" | "partial" | "not_achieved" | "insufficient_evidence";
  score: number | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  evidenceIds: string[];
  contradictionEvidenceIds: string[];
  dimensions?: Record<string, unknown>;
  judge: string;
  selection?: JudgeSelection;
  createdAt: number;
}

function safeParseSelection(value: string): JudgeSelection | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<JudgeSelection>;
    if (typeof parsed?.source !== "string" || typeof parsed?.model !== "string") return undefined;
    return parsed as JudgeSelection;
  } catch { return undefined; }
}

/** All persisted LLM-judge outcome scores, keyed by session file. */
export function loadJudgments(): Map<string, StoredJudgment> {
  const out = new Map<string, StoredJudgment>();
  const conn = getCacheDb();
  if (!conn) return out;
  try {
    const rows = conn.prepare("SELECT * FROM outcome_judgments").all() as Array<{
      file: string; session_id: string | null; mtime_ms: number; score: number;
      reasons_json: string; judge: string; judged_at: number; prompt_version: number | null; selection_json: string | null;
      evidence_digest?: string | null; evidence_version?: string | null; revision?: string | null; source_id?: string | null;
      verdict_status?: string | null; confidence?: string | null; evidence_ids_json?: string | null; contradiction_ids_json?: string | null;
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
        selection: r.selection_json ? safeParseSelection(r.selection_json) : undefined,
        evidenceDigest: r.evidence_digest ?? null,
        evidenceVersion: r.evidence_version ?? null,
        revision: r.revision ?? null,
        sourceId: r.source_id ?? null,
        verdictStatus: r.verdict_status === "achieved" || r.verdict_status === "partial" || r.verdict_status === "not_achieved" || r.verdict_status === "insufficient_evidence" ? r.verdict_status : undefined,
        confidence: r.confidence === "high" || r.confidence === "medium" || r.confidence === "low" ? r.confidence : undefined,
        evidenceIds: parseJsonArray(r.evidence_ids_json),
        contradictionEvidenceIds: parseJsonArray(r.contradiction_ids_json),
      });
    }
  } catch {}
  return out;
}

function parseJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 24) : [];
  } catch { return []; }
}

function parseStoredJudgmentJson(value: unknown): StoredJudgment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.file !== "string" || typeof row.judge !== "string") return null;
  const score = Number(row.score);
  const judgedAt = Number(row.judgedAt);
  const mtimeMs = Number(row.mtimeMs);
  if (!Number.isFinite(score) || !Number.isFinite(judgedAt) || !Number.isFinite(mtimeMs) || !Array.isArray(row.reasons)) return null;
  const reasons = row.reasons.filter((item): item is string => typeof item === "string").slice(0, 24);
  const result: StoredJudgment = {
    file: row.file,
    sessionId: typeof row.sessionId === "string" || row.sessionId === null ? row.sessionId : null,
    mtimeMs,
    score,
    reasons,
    judge: row.judge,
    judgedAt,
  };
  if (typeof row.promptVersion === "number" || row.promptVersion === null) result.promptVersion = row.promptVersion;
  if (row.selection && typeof row.selection === "object") {
    const selection = safeParseSelection(JSON.stringify(row.selection));
    if (selection) result.selection = selection;
  }
  for (const [key, field] of [["evidenceDigest", "evidenceDigest"], ["evidenceVersion", "evidenceVersion"], ["revision", "revision"], ["sourceId", "sourceId"]] as const) {
    if (typeof row[field] === "string" || row[field] === null) (result as unknown as Record<string, unknown>)[key] = row[field];
  }
  if (row.verdictStatus === "achieved" || row.verdictStatus === "partial" || row.verdictStatus === "not_achieved" || row.verdictStatus === "insufficient_evidence") result.verdictStatus = row.verdictStatus;
  if (row.confidence === "high" || row.confidence === "medium" || row.confidence === "low") result.confidence = row.confidence;
  if (Array.isArray(row.evidenceIds)) result.evidenceIds = row.evidenceIds.filter((item): item is string => typeof item === "string").slice(0, 24);
  if (Array.isArray(row.contradictionEvidenceIds)) result.contradictionEvidenceIds = row.contradictionEvidenceIds.filter((item): item is string => typeof item === "string").slice(0, 24);
  if (row.dimensions && typeof row.dimensions === "object" && !Array.isArray(row.dimensions)) result.dimensions = row.dimensions as Record<string, unknown>;
  return result;
}

function storedJudgmentFromProjectionRow(row: Record<string, unknown>): StoredJudgment | null {
  let selection: unknown;
  try { selection = row.selection_json ? JSON.parse(String(row.selection_json)) : undefined; } catch { selection = undefined; }
  let dimensions: unknown;
  try { dimensions = row.dimensions_json ? JSON.parse(String(row.dimensions_json)) : undefined; } catch { dimensions = undefined; }
  const value: Record<string, unknown> = {
    file: row.file,
    sessionId: row.session_id,
    mtimeMs: row.mtime_ms,
    score: row.score,
    reasons: (() => { try { const parsed = row.reasons_json ? JSON.parse(String(row.reasons_json)) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } })(),
    judge: row.judge,
    judgedAt: row.judged_at,
  };
  if (row.prompt_version != null) value.promptVersion = row.prompt_version;
  if (selection !== undefined) value.selection = selection;
  if (row.evidence_digest != null) value.evidenceDigest = row.evidence_digest;
  if (row.evidence_version != null) value.evidenceVersion = row.evidence_version;
  if (row.revision != null) value.revision = row.revision;
  if (row.source_id != null) value.sourceId = row.source_id;
  if (row.verdict_status != null) value.verdictStatus = row.verdict_status;
  if (row.confidence != null) value.confidence = row.confidence;
  if (row.evidence_ids_json != null) {
    const evidenceIds = parseJsonArray(row.evidence_ids_json as string);
    if (evidenceIds.length) value.evidenceIds = evidenceIds;
  }
  if (row.contradiction_ids_json != null) {
    const contradictionIds = parseJsonArray(row.contradiction_ids_json as string);
    if (contradictionIds.length) value.contradictionEvidenceIds = contradictionIds;
  }
  if (dimensions !== undefined) value.dimensions = dimensions;
  return parseStoredJudgmentJson(value);
}

/** All v4 evidence receipts, retaining multiple historical reviews per file. */
export function loadJudgeReceipts(file?: string): StoredJudgeReceipt[] {
  const conn = getCacheDb();
  if (!conn) return [];
  try {
    const rows = (file
      ? conn.prepare("SELECT * FROM judge_receipts WHERE file = ? ORDER BY created_at ASC, receipt_id ASC").all(file)
      : conn.prepare("SELECT * FROM judge_receipts ORDER BY created_at ASC, receipt_id ASC").all()) as Array<{
        receipt_id: string; file: string; source_id: string | null; session_id: string | null; revision: string;
        evidence_digest: string | null; evidence_version: string; prompt_version: number; verdict_status: string;
        score: number | null; confidence: string; reasons_json: string; evidence_ids_json: string;
        contradiction_ids_json: string; judge: string; selection_json: string | null; created_at: number;
        dimensions_json: string | null;
      }>;
    return rows.map((row) => ({
      receiptId: row.receipt_id,
      file: row.file,
      sourceId: row.source_id,
      sessionId: row.session_id,
      revision: row.revision,
      evidenceDigest: row.evidence_digest,
      evidenceVersion: row.evidence_version,
      promptVersion: Number(row.prompt_version),
      outcome: row.verdict_status === "achieved" || row.verdict_status === "partial" || row.verdict_status === "not_achieved" ? row.verdict_status : "insufficient_evidence",
      status: row.verdict_status === "achieved" || row.verdict_status === "partial" || row.verdict_status === "not_achieved" ? row.verdict_status : "insufficient_evidence",
      score: row.score == null || !Number.isFinite(row.score) ? null : row.score,
      confidence: row.confidence === "high" || row.confidence === "medium" ? row.confidence : "low",
      reasons: parseJsonArray(row.reasons_json),
      evidenceIds: parseJsonArray(row.evidence_ids_json),
      contradictionEvidenceIds: parseJsonArray(row.contradiction_ids_json),
      dimensions: (() => { try { const parsed = row.dimensions_json ? JSON.parse(row.dimensions_json) : undefined; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined; } catch { return undefined; } })(),
      judge: row.judge,
      selection: row.selection_json ? safeParseSelection(row.selection_json) : undefined,
      createdAt: Number(row.created_at),
    }));
  } catch { return []; }
}

/** Superseded numeric projections retained without inventing v4 evidence fields. */
export function loadLegacyJudgeHistory(file?: string): StoredJudgment[] {
  const conn = getCacheDb();
  if (!conn) return [];
  try {
    const rows = (file
      ? conn.prepare("SELECT judgment_json FROM judge_legacy_history WHERE file = ? ORDER BY archived_at ASC, history_id ASC").all(file)
      : conn.prepare("SELECT judgment_json FROM judge_legacy_history ORDER BY archived_at ASC, history_id ASC").all()) as Array<{ judgment_json: string }>;
    const out: StoredJudgment[] = [];
    for (const row of rows) {
      try {
        const judgment = parseStoredJudgmentJson(JSON.parse(row.judgment_json));
        if (judgment) out.push(judgment);
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

/** Most recent v4 receipt per source file, retaining unknown receipts. */
export function loadLatestJudgeReceipts(): Map<string, StoredJudgeReceipt> {
  const out = new Map<string, StoredJudgeReceipt>();
  for (const receipt of loadJudgeReceipts()) out.set(receipt.file, receipt);
  return out;
}

/** Persist an evidence-bound receipt without overwriting historical reviews. */
export function saveJudgeReceipt(receipt: StoredJudgeReceipt, opts: { leaseId?: string | null } = {}): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    const write = () => {
      if (opts.leaseId != null && !judgeJobLeaseOwnedOnConnection(conn, opts.leaseId)) return false;
      // Keep the historical receipt and current projection stores as one
      // durable contract. A cache missing the projection table is not a
      // successful judge persistence, even when the additive history table
      // happens to remain available.
      const projection = conn.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'outcome_judgments'").get() as { present?: number } | undefined;
      if (!projection?.present) return false;
      return conn.prepare(
        `INSERT INTO judge_receipts
          (receipt_id, file, source_id, session_id, revision, evidence_digest, evidence_version, prompt_version,
           verdict_status, score, confidence, reasons_json, evidence_ids_json, contradiction_ids_json, dimensions_json, judge, selection_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receipt.receiptId, receipt.file, receipt.sourceId, receipt.sessionId, receipt.revision, receipt.evidenceDigest,
        receipt.evidenceVersion, receipt.promptVersion, receipt.outcome, receipt.score, receipt.confidence,
        JSON.stringify(receipt.reasons), JSON.stringify(receipt.evidenceIds), JSON.stringify(receipt.contradictionEvidenceIds),
        receipt.dimensions ? JSON.stringify(receipt.dimensions) : null, receipt.judge, receipt.selection ? JSON.stringify(receipt.selection) : null, receipt.createdAt,
      ).changes === 1;
    };
    return opts.leaseId == null ? write() : conn.transaction(write)() === true;
  } catch { return false; }
}

/**
 * Persist a verdict and report whether the durable receipt was actually
 * written. When a lease is supplied, the ownership check and the upsert share
 * one SQLite transaction so a worker that lost takeover cannot write a stale
 * verdict into the new job's population.
 */
export function saveJudgment(j: StoredJudgment, opts: { leaseId?: string | null } = {}): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    const write = () => {
      if (opts.leaseId != null && !judgeJobLeaseOwnedOnConnection(conn, opts.leaseId)) return false;
      return conn
        .prepare(
          `INSERT INTO outcome_judgments
             (file, session_id, mtime_ms, score, reasons_json, judge, judged_at, prompt_version, selection_json,
              evidence_digest, evidence_version, revision, source_id, verdict_status, confidence, evidence_ids_json, contradiction_ids_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(file) DO UPDATE SET session_id = excluded.session_id, mtime_ms = excluded.mtime_ms,
             score = excluded.score, reasons_json = excluded.reasons_json, judge = excluded.judge,
             judged_at = excluded.judged_at, prompt_version = excluded.prompt_version, selection_json = excluded.selection_json,
             evidence_digest = excluded.evidence_digest, evidence_version = excluded.evidence_version, revision = excluded.revision,
             source_id = excluded.source_id, verdict_status = excluded.verdict_status, confidence = excluded.confidence,
             evidence_ids_json = excluded.evidence_ids_json, contradiction_ids_json = excluded.contradiction_ids_json`,
        )
        .run(
          j.file, j.sessionId, j.mtimeMs, j.score, JSON.stringify(j.reasons), j.judge, j.judgedAt, j.promptVersion ?? null,
          j.selection ? JSON.stringify(j.selection) : null, j.evidenceDigest ?? null, j.evidenceVersion ?? null, j.revision ?? null,
          j.sourceId ?? null, j.verdictStatus ?? "pass", j.confidence ?? null, JSON.stringify(j.evidenceIds ?? []), JSON.stringify(j.contradictionEvidenceIds ?? []),
        )
        .changes === 1;
    };
    return opts.leaseId == null ? write() : conn.transaction(write)() === true;
  } catch {
    return false;
  }
}

/** Remove the current numeric projection while retaining historical receipts. */
export function clearJudgmentProjection(file: string, opts: { leaseId?: string | null } = {}): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    const write = () => {
      if (opts.leaseId != null && !judgeJobLeaseOwnedOnConnection(conn, opts.leaseId)) return false;
      conn.prepare("DELETE FROM outcome_judgments WHERE file = ?").run(file);
      return true;
    };
    return opts.leaseId == null ? write() : conn.transaction(write)() === true;
  } catch {
    return false;
  }
}

function projectionHasEquivalentReceipt(conn: Database.Database, projection: StoredJudgment): boolean {
  if (!projection.evidenceDigest || !projection.evidenceVersion || projection.promptVersion == null || !projection.revision) return false;
  try {
    const rows = conn.prepare(
      "SELECT evidence_digest, evidence_version, prompt_version, revision FROM judge_receipts WHERE file = ?",
    ).all(projection.file) as Array<{ evidence_digest: string | null; evidence_version: string; prompt_version: number; revision: string }>;
    return rows.some((row) => row.evidence_digest === projection.evidenceDigest
      && row.evidence_version === projection.evidenceVersion
      && Number(row.prompt_version) === projection.promptVersion
      && row.revision === projection.revision);
  } catch {
    return false;
  }
}

function archiveLegacyProjection(conn: Database.Database, projection: StoredJudgment): boolean {
  const judgmentJson = JSON.stringify(projection);
  const duplicate = conn.prepare(
    "SELECT 1 AS present FROM judge_legacy_history WHERE file = ? AND judged_at = ? AND judgment_json = ? LIMIT 1",
  ).get(projection.file, projection.judgedAt, judgmentJson) as { present?: number } | undefined;
  if (duplicate?.present) return true;
  return conn.prepare(
    "INSERT INTO judge_legacy_history (file, judged_at, archived_at, judgment_json) VALUES (?, ?, ?, ?)",
  ).run(projection.file, projection.judgedAt, Date.now(), judgmentJson).changes === 1;
}

/**
 * Atomically retain a new evidence receipt and update its current numeric
 * projection. A null projection deliberately deletes the old score while
 * preserving the receipt and any superseded legacy projection.
 */
export function saveEvidenceJudgment(
  receipt: StoredJudgeReceipt,
  projection: StoredJudgment | null,
  opts: { leaseId?: string | null } = {},
): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    const tx = conn.transaction(() => {
      if (opts.leaseId != null && !judgeJobLeaseOwnedOnConnection(conn, opts.leaseId)) return false;
      if (projection != null && (projection.file !== receipt.file || projection.sessionId !== receipt.sessionId || projection.score !== receipt.score || projection.promptVersion !== receipt.promptVersion)) return false;
      if ((projection == null) !== (receipt.score == null)) return false;
      const existingRow = conn.prepare("SELECT * FROM outcome_judgments WHERE file = ?").get(receipt.file) as Record<string, unknown> | undefined;
      const existing = existingRow ? storedJudgmentFromProjectionRow(existingRow) : null;
      if (existing && !projectionHasEquivalentReceipt(conn, existing) && !archiveLegacyProjection(conn, existing)) throw new Error("legacy archive write was ignored");

      const receiptInsert = conn.prepare(
        `INSERT INTO judge_receipts
          (receipt_id, file, source_id, session_id, revision, evidence_digest, evidence_version, prompt_version,
           verdict_status, score, confidence, reasons_json, evidence_ids_json, contradiction_ids_json, dimensions_json, judge, selection_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receipt.receiptId, receipt.file, receipt.sourceId, receipt.sessionId, receipt.revision, receipt.evidenceDigest,
        receipt.evidenceVersion, receipt.promptVersion, receipt.outcome, receipt.score, receipt.confidence,
        JSON.stringify(receipt.reasons), JSON.stringify(receipt.evidenceIds), JSON.stringify(receipt.contradictionEvidenceIds),
        receipt.dimensions ? JSON.stringify(receipt.dimensions) : null, receipt.judge, receipt.selection ? JSON.stringify(receipt.selection) : null, receipt.createdAt,
      );
      if (receiptInsert.changes !== 1) throw new Error("receipt write was ignored");

      if (projection == null) {
        const deleted = conn.prepare("DELETE FROM outcome_judgments WHERE file = ?").run(receipt.file);
        if (existing && deleted.changes !== 1) throw new Error("projection deletion was ignored");
        return true;
      }
      const projectionWrite = conn.prepare(
        `INSERT INTO outcome_judgments
           (file, session_id, mtime_ms, score, reasons_json, judge, judged_at, prompt_version, selection_json,
            evidence_digest, evidence_version, revision, source_id, verdict_status, confidence, evidence_ids_json, contradiction_ids_json, dimensions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file) DO UPDATE SET session_id = excluded.session_id, mtime_ms = excluded.mtime_ms,
           score = excluded.score, reasons_json = excluded.reasons_json, judge = excluded.judge,
           judged_at = excluded.judged_at, prompt_version = excluded.prompt_version, selection_json = excluded.selection_json,
           evidence_digest = excluded.evidence_digest, evidence_version = excluded.evidence_version, revision = excluded.revision,
           source_id = excluded.source_id, verdict_status = excluded.verdict_status, confidence = excluded.confidence,
           evidence_ids_json = excluded.evidence_ids_json, contradiction_ids_json = excluded.contradiction_ids_json,
           dimensions_json = excluded.dimensions_json`,
      ).run(
        projection.file, projection.sessionId, projection.mtimeMs, projection.score, JSON.stringify(projection.reasons), projection.judge,
        projection.judgedAt, projection.promptVersion ?? null, projection.selection ? JSON.stringify(projection.selection) : null,
        projection.evidenceDigest ?? null, projection.evidenceVersion ?? null, projection.revision ?? null, projection.sourceId ?? null,
        projection.verdictStatus ?? "pass", projection.confidence ?? null, JSON.stringify(projection.evidenceIds ?? []),
        JSON.stringify(projection.contradictionEvidenceIds ?? []), projection.dimensions ? JSON.stringify(projection.dimensions) : null,
      );
      if (projectionWrite.changes !== 1) throw new Error("projection write was ignored");
      return true;
    });
    return tx() === true;
  } catch {
    return false;
  }
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

// ---------- Durable judge-all job ledger ----------

/** A lease is considered detached after this interval without a heartbeat. */
export const JUDGE_JOB_LEASE_MS = 30_000;

function judgeJobLeaseOwnedOnConnection(conn: Database.Database, leaseId: string, now = Date.now()): boolean {
  try {
    const row = conn.prepare("SELECT state, lease_id, heartbeat_at FROM judge_jobs WHERE id = 1").get() as
      | { state: string; lease_id: string | null; heartbeat_at: number | null }
      | undefined;
    return row?.state === "running"
      && row.lease_id === leaseId
      && typeof row.heartbeat_at === "number"
      && Number.isFinite(row.heartbeat_at)
      && now - row.heartbeat_at <= JUDGE_JOB_LEASE_MS;
  } catch {
    return false;
  }
}

/** Read-only lease fence used by workers immediately before provider work. */
export function judgeJobLeaseOwned(leaseId: string, now = Date.now()): boolean {
  const conn = getCacheDb();
  return conn != null && leaseId.length > 0 && judgeJobLeaseOwnedOnConnection(conn, leaseId, now);
}

export type StoredJudgeJobState = "running" | "finished" | "interrupted";

/** Durable status for the singleton marker-window judge-all pass. */
export interface StoredJudgeJob {
  state: StoredJudgeJobState;
  total: number;
  done: number;
  judged: number;
  failed: number;
  judge: string;
  selection?: JudgeSelection;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  /** Session paths queued for this pass; verdicts/failures remain source of truth on resume. */
  queue: string[];
  leaseId: string | null;
  ownerPid: number | null;
  heartbeatAt: number | null;
}

type JudgeJobRow = {
  state: string;
  total: number;
  done: number;
  judged: number;
  failed: number;
  judge: string;
  selection_json: string | null;
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
  queue_json: string;
  lease_id: string | null;
  owner_pid: number | null;
  heartbeat_at: number | null;
};

function parseJudgeJob(row: JudgeJobRow | undefined): StoredJudgeJob | null {
  if (!row) return null;
  let queue: string[] = [];
  try {
    const parsed = JSON.parse(row.queue_json);
    if (Array.isArray(parsed)) queue = parsed.filter((p): p is string => typeof p === "string");
  } catch {}
  const state: StoredJudgeJobState = row.state === "running" || row.state === "finished" || row.state === "interrupted"
    ? row.state
    : "interrupted";
  return {
    state,
    total: Math.max(0, Number(row.total) || 0),
    done: Math.max(0, Number(row.done) || 0),
    judged: Math.max(0, Number(row.judged) || 0),
    failed: Math.max(0, Number(row.failed) || 0),
    judge: row.judge || "",
    selection: row.selection_json ? safeParseSelection(row.selection_json) : undefined,
    startedAt: row.started_at == null ? null : Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    lastError: row.last_error ?? null,
    queue,
    leaseId: row.lease_id ?? null,
    ownerPid: row.owner_pid == null ? null : Number(row.owner_pid),
    heartbeatAt: row.heartbeat_at == null ? null : Number(row.heartbeat_at),
  };
}

const judgeJobSelect = (conn: Database.Database): StoredJudgeJob | null => {
  try {
    return parseJudgeJob(conn.prepare("SELECT state, total, done, judged, failed, judge, selection_json, started_at, finished_at, last_error, queue_json, lease_id, owner_pid, heartbeat_at FROM judge_jobs WHERE id = 1").get() as JudgeJobRow | undefined);
  } catch {
    return null;
  }
};

/** Read the durable judge-all row, independent of any module singleton. */
export function loadJudgeJob(): StoredJudgeJob | null {
  const conn = getCacheDb();
  return conn ? judgeJobSelect(conn) : null;
}

/** Test and recovery hook: replace the durable singleton row. */
export function saveJudgeJob(job: StoredJudgeJob): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    conn.prepare(
      `INSERT INTO judge_jobs (id, state, total, done, judged, failed, judge, selection_json, started_at, finished_at, last_error, queue_json, lease_id, owner_pid, heartbeat_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, total = excluded.total, done = excluded.done,
         judged = excluded.judged, failed = excluded.failed, judge = excluded.judge, selection_json = excluded.selection_json, started_at = excluded.started_at,
         finished_at = excluded.finished_at, last_error = excluded.last_error, queue_json = excluded.queue_json,
         lease_id = excluded.lease_id, owner_pid = excluded.owner_pid, heartbeat_at = excluded.heartbeat_at`,
    ).run(
      job.state, job.total, job.done, job.judged, job.failed, job.judge, job.selection ? JSON.stringify(job.selection) : null, job.startedAt, job.finishedAt,
      job.lastError, JSON.stringify(job.queue), job.leaseId, job.ownerPid, job.heartbeatAt,
    );
  } catch {}
}

/**
 * Atomically claim the singleton row. `takeoverLeaseId` is required when a
 * caller has proved that the prior lease is stale or belongs to a replaced
 * HMR module; the conditional update prevents two resumptions racing.
 */
export function claimJudgeJob(job: StoredJudgeJob, opts: { takeoverLeaseId?: string | null } = {}): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    const tx = conn.transaction(() => {
      const current = judgeJobSelect(conn);
      if (current?.state === "running") {
        const takeover = opts.takeoverLeaseId != null && current.leaseId === opts.takeoverLeaseId;
        if (!takeover) return false;
        const result = conn.prepare(
          `UPDATE judge_jobs SET state = ?, total = ?, done = ?, judged = ?, failed = ?, judge = ?, selection_json = ?, started_at = ?,
             finished_at = ?, last_error = ?, queue_json = ?, lease_id = ?, owner_pid = ?, heartbeat_at = ?
           WHERE id = 1 AND state = 'running' AND lease_id = ?`,
        ).run(
          job.state, job.total, job.done, job.judged, job.failed, job.judge, job.selection ? JSON.stringify(job.selection) : null, job.startedAt, job.finishedAt,
          job.lastError, JSON.stringify(job.queue), job.leaseId, job.ownerPid, job.heartbeatAt, current.leaseId,
        );
        return result.changes === 1;
      }
      const result = conn.prepare(
        `INSERT INTO judge_jobs (id, state, total, done, judged, failed, judge, selection_json, started_at, finished_at, last_error, queue_json, lease_id, owner_pid, heartbeat_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, total = excluded.total, done = excluded.done,
           judged = excluded.judged, failed = excluded.failed, judge = excluded.judge, selection_json = excluded.selection_json, started_at = excluded.started_at,
           finished_at = excluded.finished_at, last_error = excluded.last_error, queue_json = excluded.queue_json,
           lease_id = excluded.lease_id, owner_pid = excluded.owner_pid, heartbeat_at = excluded.heartbeat_at`,
      ).run(
        job.state, job.total, job.done, job.judged, job.failed, job.judge, job.selection ? JSON.stringify(job.selection) : null, job.startedAt, job.finishedAt,
        job.lastError, JSON.stringify(job.queue), job.leaseId, job.ownerPid, job.heartbeatAt,
      );
      return result.changes === 1;
    });
    return tx() === true;
  } catch {
    return false;
  }
}

/** Refresh a live lease. Updates are conditional so a superseded worker is inert. */
export function heartbeatJudgeJob(leaseId: string, heartbeatAt = Date.now()): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    return conn.prepare("UPDATE judge_jobs SET heartbeat_at = ? WHERE id = 1 AND state = 'running' AND lease_id = ?")
      .run(heartbeatAt, leaseId).changes === 1;
  } catch {
    return false;
  }
}

/** Persist one completed queue item. */
export function updateJudgeJobProgress(leaseId: string, result: { ok: boolean; error?: string | null }): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    const now = Date.now();
    const sql = result.ok
      ? "UPDATE judge_jobs SET done = done + 1, judged = judged + 1, heartbeat_at = ? WHERE id = 1 AND state = 'running' AND lease_id = ?"
      : "UPDATE judge_jobs SET done = done + 1, failed = failed + 1, heartbeat_at = ?, last_error = ? WHERE id = 1 AND state = 'running' AND lease_id = ?";
    const params = result.ok ? [now, leaseId] : [now, (result.error ?? "judge failed").slice(0, 300), leaseId];
    return conn.prepare(sql).run(...params).changes === 1;
  } catch {
    return false;
  }
}

/** Mark a claimed job complete; a stale/superseded worker cannot finish a newer job. */
export function finishJudgeJob(leaseId: string, finishedAt = Date.now()): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    return conn.prepare("UPDATE judge_jobs SET state = 'finished', finished_at = ?, lease_id = NULL, owner_pid = NULL, heartbeat_at = NULL WHERE id = 1 AND state = 'running' AND lease_id = ?")
      .run(finishedAt, leaseId).changes === 1;
  } catch {
    return false;
  }
}

/** Persist an interrupted state while retaining the queue for a later resume. */
export function interruptJudgeJob(leaseId: string, error: string, finishedAt = Date.now()): boolean {
  const conn = getCacheDb();
  if (!conn) return false;
  try {
    return conn.prepare("UPDATE judge_jobs SET state = 'interrupted', finished_at = ?, last_error = ?, lease_id = NULL, owner_pid = NULL, heartbeat_at = NULL WHERE id = 1 AND state = 'running' AND lease_id = ?")
      .run(finishedAt, error.slice(0, 300), leaseId).changes === 1;
  } catch {
    return false;
  }
}

/**
 * Failed judge attempts, keyed by session file. Without this ledger, a file
 * that can never be judged (deleted, unparseable, or an unavailable judge)
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

/**
 * Defense-in-depth bound for text entering the durable search index. The
 * extractor already supplies head+tail excerpts, but keeping the invariant at
 * the SQLite boundary prevents a future caller from mirroring a full
 * transcript into the cache. This is a cache-only bound; raw files and parsed
 * session summaries remain untouched.
 */
export const FTS_TEXT_CAP_PER_FIELD = 32_000;
const FTS_TEXT_HEAD_CAP = FTS_TEXT_CAP_PER_FIELD / 2;
const FTS_TEXT_GAP = "\n[…]\n";

function boundFtsText(text: string): string {
  if (text.length <= FTS_TEXT_CAP_PER_FIELD) return text;
  const tailCap = FTS_TEXT_CAP_PER_FIELD - FTS_TEXT_HEAD_CAP - FTS_TEXT_GAP.length;
  return `${text.slice(0, FTS_TEXT_HEAD_CAP)}${FTS_TEXT_GAP}${text.slice(-tailCap)}`;
}

/** Files already indexed, with stat and optional bounded content identity. */
export function ftsIndexedFiles(): Map<string, { mtimeMs: number; size: number; contentFingerprint?: string; sourceId?: string }> {
  const out = new Map<string, { mtimeMs: number; size: number; contentFingerprint?: string; sourceId?: string }>();
  const conn = getCacheDb();
  if (!conn) return out;
  try {
    for (const r of conn.prepare("SELECT file, mtime_ms, size, content_fingerprint, source_id FROM fts_meta WHERE index_version = ?").all(FTS_INDEX_VERSION) as Array<{ file: string; mtime_ms: number; size: number; content_fingerprint?: string | null; source_id?: string | null }>) {
      out.set(r.file, {
        mtimeMs: r.mtime_ms,
        size: r.size,
        ...(r.content_fingerprint ? { contentFingerprint: r.content_fingerprint } : {}),
        ...(r.source_id ? { sourceId: r.source_id } : {}),
      });
    }
  } catch {}
  return out;
}

/** (Re-)index one file's extracted text. Replaces any previous rows for the file. */
export function ftsUpsert(doc: FtsDoc, mtimeMs: number, size: number, contentFingerprint?: string): void {
  const conn = getCacheDb();
  if (!conn) return;
  try {
    const previous = conn.prepare("SELECT mtime_ms, size, index_version, content_fingerprint, source_id, fts_rowid FROM fts_meta WHERE file = ?").get(doc.file) as
      | { mtime_ms: number; size: number; index_version: number; content_fingerprint: string | null; source_id: string | null; fts_rowid: number | null }
      | undefined;
    // Index passes are explicit and normally skip unchanged files before they
    // reach this function. Keep the lower-level API idempotent too: callers
    // that retry a batch must not delete/reinsert the same FTS row or dirty the
    // WAL. A missing rowid falls through so legacy metadata is repaired.
    if (
      previous && previous.mtime_ms === mtimeMs && previous.size === size &&
      previous.index_version === FTS_INDEX_VERSION && previous.fts_rowid != null &&
      previous.source_id === doc.sourceId &&
      (contentFingerprint === undefined
        ? !previous.content_fingerprint
        : previous.content_fingerprint === contentFingerprint) &&
      conn.prepare("SELECT 1 FROM session_fts WHERE rowid = ?").get(previous.fts_rowid)
    ) return;

    // Enforce the excerpt bound at the durable-storage boundary as well as in
    // the producer. Head+tail preserves both task framing and final outcomes.
    const userText = boundFtsText(doc.userText);
    const assistantText = boundFtsText(doc.assistantText);
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
        .run(userText, assistantText, doc.title, doc.project, doc.sourceId, doc.file, doc.at);
      conn
        .prepare(
          `INSERT INTO fts_meta (file, mtime_ms, size, indexed_at, fts_rowid, index_version, content_fingerprint, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
             indexed_at = excluded.indexed_at, fts_rowid = excluded.fts_rowid,
             index_version = excluded.index_version, content_fingerprint = excluded.content_fingerprint,
             source_id = excluded.source_id`,
        )
        .run(doc.file, mtimeMs, size, Date.now(), Number(inserted.lastInsertRowid), FTS_INDEX_VERSION, contentFingerprint ?? "", doc.sourceId);
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
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 200)) : 50;
  try {
    const rows = conn
      .prepare(
        `SELECT file, source_id, project, title, at,
                snippet(session_fts, 0, '«', '»', ' … ', 14) AS snip_user,
                snippet(session_fts, 1, '«', '»', ' … ', 14) AS snip_assistant
         FROM session_fts WHERE session_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, safeLimit) as Array<{
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
