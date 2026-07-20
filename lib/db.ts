import Database from "better-sqlite3";
import fs from "node:fs";
import { DB_PATH, ensureDirs } from "./config";
import type { RunCaseRecord, RunRecord, RunSummary } from "./types";

let db: Database.Database | null = null;
let triedCorruptionRecovery = false;

/**
 * Set once per process when a corrupt eval.db was moved aside and recreated.
 * Surfaced through /api/settings/maintenance so the operator learns about the
 * recovery (and where the old file went) instead of the process crash-looping.
 */
export interface DbRecoveryNotice {
  at: number;
  reason: string;
  movedAsideTo: string;
}
let recoveryNotice: DbRecoveryNotice | null = null;

export function getDbRecoveryNotice(): DbRecoveryNotice | null {
  return recoveryNotice;
}

function openDb(): Database.Database {
  const conn = new Database(DB_PATH, { timeout: 15_000 });
  try {
    conn.pragma("busy_timeout = 15000");
    try { conn.pragma("journal_mode = WAL"); } catch {}
    conn.pragma("synchronous = NORMAL");
    conn.exec(SCHEMA);
    migrate(conn);
    return conn;
  } catch (e) {
    // Corrupt files typically survive `new Database()` (open is lazy) and blow
    // up here. Close the handle before recovery renames the file out from
    // under it — platforms that lock open files would fail the rename.
    try { conn.close(); } catch {}
    throw e;
  }
}

function quickCheckIssue(conn: Database.Database): string | null {
  const rows = conn.pragma("quick_check") as Array<Record<string, unknown>>;
  const messages = rows
    .map((r) => String(Object.values(r)[0] ?? ""))
    .filter((m) => m !== "ok" && m !== "");
  return messages.length ? `quick_check: ${messages.join("; ")}` : null;
}

export function getDb(): Database.Database {
  if (db) return db;
  ensureDirs();
  try {
    const conn = openDb();
    // First open per process: cheap structural validation. A DB that opens but
    // is internally corrupt would otherwise fail on some arbitrary later query.
    const issue = quickCheckIssue(conn);
    if (issue) {
      try { conn.close(); } catch {}
      throw Object.assign(new Error(issue), { code: "SQLITE_CORRUPT" });
    }
    db = conn;
    return conn;
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if ((code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") && !triedCorruptionRecovery) {
      triedCorruptionRecovery = true;
      // Same recovery contract as lib/live-cache.ts: move the bad file aside
      // for forensics (never delete history) and start fresh, once per process.
      const suffix = `.corrupt-${Date.now()}`;
      fs.renameSync(DB_PATH, DB_PATH + suffix);
      // WAL/SHM siblings belong to the corrupt file; a fresh DB must not inherit them.
      for (const ext of ["-wal", "-shm"]) {
        try { fs.renameSync(DB_PATH + ext, DB_PATH + ext + suffix); } catch {}
      }
      db = openDb();
      recoveryNotice = {
        at: Date.now(),
        reason: String((e as Error)?.message || code),
        movedAsideTo: DB_PATH + suffix,
      };
      console.warn(
        `[openeval] eval.db failed to open cleanly (${recoveryNotice.reason}); ` +
        `the corrupt file was moved to ${DB_PATH + suffix} and a fresh database was created. ` +
        `Run history before this point is in the moved-aside file.`
      );
      return db;
    }
    throw e;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  params_json TEXT NOT NULL,
  summary_json TEXT,
  manifest_json TEXT
);

CREATE TABLE IF NOT EXISTS run_cases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_name TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT,
  status TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  workdir_path TEXT NOT NULL,
  transcript_path TEXT,
  runner_kind TEXT NOT NULL,
  runner_result_json TEXT,
  grader_result_json TEXT,
  evaluation_json TEXT,
  budget_exceeded INTEGER DEFAULT 0,
  case_def_json TEXT NOT NULL,
  error_msg TEXT,
  seq INTEGER NOT NULL,
  sample INTEGER DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_cases_run ON run_cases(run_id);
CREATE INDEX IF NOT EXISTS idx_run_cases_seq ON run_cases(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_run_cases_case_sample ON run_cases(run_id, case_id, sample);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  case_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, at);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`;

/**
 * Versioned data migrations, recorded in the schema_version table. Additive
 * column migrations stay idempotent presence-checks (below) because existing
 * DBs are at arbitrary column states; anything that rewrites data belongs
 * here with a monotonically increasing version.
 *
 * Versions <= the legacy `PRAGMA user_version` value are considered already
 * applied by the pre-schema_version scheme and are recorded without re-running.
 */
const MIGRATIONS: Array<{ version: number; apply: (conn: Database.Database) => void }> = [
  {
    version: 1,
    apply: (conn) => {
      conn.exec("UPDATE run_cases SET evaluation_json = NULL WHERE evaluation_json = grader_result_json");
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

function migrate(conn: Database.Database) {
  const runCols = conn.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  const runNames = new Set(runCols.map((c) => c.name));
  if (!runNames.has("manifest_json")) {
    try { conn.exec("ALTER TABLE runs ADD COLUMN manifest_json TEXT"); } catch {}
  }

  const cols = conn.prepare("PRAGMA table_info(run_cases)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const add = (col: string, decl: string) => {
    if (!names.has(col)) { try { conn.exec(`ALTER TABLE run_cases ADD COLUMN ${col} ${decl}`); } catch {} }
  };
  add("difficulty", "TEXT");
  add("budget_exceeded", "INTEGER DEFAULT 0");
  add("sample", "INTEGER DEFAULT 0");
  add("harness_info_json", "TEXT");

  const legacyVersion = Number(conn.prepare("PRAGMA user_version").pluck().get() ?? 0);
  const applied = new Set(
    (conn.prepare("SELECT version FROM schema_version").pluck().all() as number[]).map(Number)
  );
  const record = conn.prepare("INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)");
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    if (m.version <= legacyVersion) {
      record.run(m.version, Date.now());
      continue;
    }
    conn.transaction(() => {
      m.apply(conn);
      record.run(m.version, Date.now());
    })();
  }
  // Keep the legacy marker in sync so older checkouts sharing this DB don't
  // re-run migrations the new scheme already applied.
  try { conn.pragma(`user_version = ${SCHEMA_VERSION}`); } catch {}
}

export function getSchemaVersion(): number {
  const v = getDb().prepare("SELECT MAX(version) FROM schema_version").pluck().get() as number | null;
  return Number(v ?? 0);
}

// ---------------------------------------------------------------------------
// Maintenance (used by /api/settings/maintenance)
// ---------------------------------------------------------------------------

export interface DbIntegrityResult {
  ok: boolean;
  messages: string[];
  checkedAt: number;
}

/** `quick_check` by default; `full` runs the exhaustive `integrity_check`. */
export function checkDbIntegrity(full = false): DbIntegrityResult {
  const rows = getDb().pragma(full ? "integrity_check" : "quick_check") as Array<Record<string, unknown>>;
  const messages = rows
    .map((r) => String(Object.values(r)[0] ?? ""))
    .filter((m) => m !== "ok" && m !== "");
  return { ok: messages.length === 0, messages, checkedAt: Date.now() };
}

export interface WalCheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

export function walCheckpointTruncate(): WalCheckpointResult {
  const rows = getDb().pragma("wal_checkpoint(TRUNCATE)") as Array<Record<string, unknown>>;
  const r = rows[0] ?? {};
  return {
    busy: Number(r.busy ?? 0),
    log: Number(r.log ?? 0),
    checkpointed: Number(r.checkpointed ?? 0),
  };
}

export function vacuumDb(): void {
  getDb().exec("VACUUM");
}

export interface DbStats {
  path: string;
  sizeBytes: number;
  walBytes: number;
  shmBytes: number;
  pageSizeBytes: number;
  pageCount: number;
  freelistPages: number;
  journalMode: string;
  schemaVersion: number;
  tables: { runs: number; run_cases: number; events: number };
  recovery: DbRecoveryNotice | null;
}

function fileSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

export function getDbStats(): DbStats {
  const conn = getDb();
  const count = (table: string) =>
    Number(conn.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() ?? 0);
  return {
    path: DB_PATH,
    sizeBytes: fileSize(DB_PATH),
    walBytes: fileSize(DB_PATH + "-wal"),
    shmBytes: fileSize(DB_PATH + "-shm"),
    pageSizeBytes: Number(conn.pragma("page_size", { simple: true }) ?? 0),
    pageCount: Number(conn.pragma("page_count", { simple: true }) ?? 0),
    freelistPages: Number(conn.pragma("freelist_count", { simple: true }) ?? 0),
    journalMode: String(conn.pragma("journal_mode", { simple: true }) ?? "unknown"),
    schemaVersion: getSchemaVersion(),
    tables: { runs: count("runs"), run_cases: count("run_cases"), events: count("events") },
    recovery: recoveryNotice,
  };
}

export interface RunQuery {
  caseIds?: string[];
  categories?: string[];
  tags?: string[];
}

export function insertRun(run: RunRecord): void {
  getDb().prepare(
    `INSERT INTO runs (id, name, status, created_at, ended_at, params_json, summary_json, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.id,
    run.name,
    run.status,
    run.created_at,
    run.ended_at ?? null,
    JSON.stringify(run.params),
    run.summary ? JSON.stringify(run.summary) : null,
    run.manifest ? JSON.stringify(run.manifest) : null
  );
}

export function updateRunStatus(id: string, status: RunRecord["status"], endedAt: number | null, summary: RunSummary | null): void {
  getDb().prepare(
    `UPDATE runs SET status = ?, ended_at = ?, summary_json = ? WHERE id = ?`
  ).run(status, endedAt, summary ? JSON.stringify(summary) : null, id);
}

export function updateRunManifest(id: string, manifest: unknown): void {
  getDb().prepare(`UPDATE runs SET manifest_json = ? WHERE id = ?`).run(JSON.stringify(manifest), id);
}

export function listRuns(limit = 100): RunRecord[] {
  const rows = getDb().prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit) as any[];
  return rows.map(rowToRun);
}

export function countRuns(): number {
  return Number(getDb().prepare(`SELECT COUNT(*) FROM runs`).pluck().get() ?? 0);
}

export function getRun(id: string): RunRecord | null {
  const r = getDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as any;
  return r ? rowToRun(r) : null;
}

export function getRunStatus(id: string): RunRecord["status"] | null {
  return (getDb().prepare(`SELECT status FROM runs WHERE id = ?`).pluck().get(id) as RunRecord["status"] | undefined) ?? null;
}

export function listRunsByStatus(status: RunRecord["status"]): RunRecord[] {
  const rows = getDb().prepare(`SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC`).all(status) as any[];
  return rows.map(rowToRun);
}

export function listRunCases(runId: string): RunCaseRecord[] {
  const rows = getDb().prepare(`SELECT * FROM run_cases WHERE run_id = ? ORDER BY seq ASC`).all(runId) as any[];
  return rows.map(rowToRunCase);
}

export interface RunCaseSummary {
  status: string;
  runner_cost_usd: number | null;
  runner_input_tokens: number | null;
  runner_output_tokens: number | null;
  runner_duration_ms: number | null;
}

export function getRunCaseSummariesBatch(runIds: string[]): Map<string, RunCaseSummary[]> {
  if (runIds.length === 0) return new Map();
  const placeholders = runIds.map(() => "?").join(",");
  const rows = getDb().prepare(
    `SELECT run_id, status, runner_result_json FROM run_cases WHERE run_id IN (${placeholders}) ORDER BY seq ASC`
  ).all(...runIds) as any[];
  const result = new Map<string, RunCaseSummary[]>();
  for (const row of rows) {
    let parsed: any = null;
    try { parsed = JSON.parse(row.runner_result_json); } catch {}
    const summary: RunCaseSummary = {
      status: row.status,
      runner_cost_usd: parsed?.usage?.costUsd ?? null,
      runner_input_tokens: parsed?.usage?.inputTokens ?? null,
      runner_output_tokens: parsed?.usage?.outputTokens ?? null,
      runner_duration_ms: parsed?.durationMs ?? null,
    };
    const list = result.get(row.run_id) ?? [];
    list.push(summary);
    result.set(row.run_id, list);
  }
  return result;
}

export function getRunCaseByCaseId(runId: string, caseId: string): RunCaseRecord | null {
  const rows = getDb().prepare(`SELECT * FROM run_cases WHERE run_id = ? AND (case_id = ? OR id = ?) ORDER BY seq ASC LIMIT 1`).all(runId, caseId, caseId) as any[];
  return rows.length ? rowToRunCase(rows[0]) : null;
}

export function getRunCase(id: string): RunCaseRecord | null {
  const r = getDb().prepare(`SELECT * FROM run_cases WHERE id = ?`).get(id) as any;
  return r ? rowToRunCase(r) : null;
}

export function getRunCaseBySeq(runId: string, seq: number): RunCaseRecord | null {
  const r = getDb().prepare(`SELECT * FROM run_cases WHERE run_id = ? AND seq = ?`).get(runId, seq) as any;
  return r ? rowToRunCase(r) : null;
}

export function insertRunCase(rc: RunCaseRecord & { seq: number }): void {
  getDb().prepare(
    `INSERT INTO run_cases (id, run_id, case_id, case_name, category, difficulty, status, started_at, ended_at, workdir_path, transcript_path, runner_kind, runner_result_json, grader_result_json, evaluation_json, budget_exceeded, case_def_json, error_msg, seq, sample, harness_info_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rc.id, rc.run_id, rc.case_id, rc.case_name, rc.category, rc.difficulty ?? null, rc.status,
    rc.started_at, rc.ended_at, rc.workdir_path, rc.transcript_path,
    rc.runner_kind, rc.runner_result ? JSON.stringify(rc.runner_result) : null,
    rc.grader_result ? JSON.stringify(rc.grader_result) : null,
    rc.evaluation ? JSON.stringify(rc.evaluation) : null, rc.budget_exceeded ? 1 : 0, JSON.stringify(rc.case_def), rc.error_msg, rc.seq, rc.sample ?? 0,
    rc.harness_info ? JSON.stringify(rc.harness_info) : null
  );
}

export function updateRunCase(id: string, patch: Partial<RunCaseRecord>): void {
  const cur = getRunCase(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  getDb().prepare(
    `UPDATE run_cases SET status=?, started_at=?, ended_at=?, transcript_path=?, runner_result_json=?, grader_result_json=?, evaluation_json=?, budget_exceeded=?, error_msg=?, harness_info_json=? WHERE id=?`
  ).run(
    next.status, next.started_at, next.ended_at, next.transcript_path,
    next.runner_result ? JSON.stringify(next.runner_result) : null,
    next.grader_result ? JSON.stringify(next.grader_result) : null,
    next.evaluation ? JSON.stringify(next.evaluation) : null,
    next.budget_exceeded ? 1 : 0,
    next.error_msg, next.harness_info ? JSON.stringify(next.harness_info) : null, id
  );
}

export function appendEvent(runId: string, kind: string, payload: unknown, caseId?: string): void {
  getDb().prepare(
    `INSERT INTO events (run_id, case_id, kind, payload_json, at) VALUES (?, ?, ?, ?, ?)`
  ).run(runId, caseId ?? null, kind, JSON.stringify(payload), Date.now());
}

export function listEvents(runId: string, sinceId = 0, limit = 500): Array<{ id: number; run_id: string; case_id: string | null; kind: string; payload_json: string; at: number }> {
  return getDb().prepare(`SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?`).all(runId, sinceId, limit) as any[];
}

export function getLastEventAt(runId: string): number | null {
  const at = getDb().prepare(`SELECT at FROM events WHERE run_id = ? ORDER BY id DESC LIMIT 1`).pluck().get(runId) as number | undefined;
  return at ?? null;
}

// Defensive parse: a single truncated/corrupt JSON column (e.g. a run killed
// mid-write) must not throw out of a list query and 500 the whole dashboard.
// Fall back to a sane value so the rest of the row — and every other row —
// still renders.
export function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

function rowToRun(r: any): RunRecord {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    created_at: r.created_at,
    ended_at: r.ended_at,
    params: safeParse(r.params_json, { runner: "headless", parallel: 1 } as RunRecord["params"]),
    summary: r.summary_json ? safeParse(r.summary_json, null) : null,
    manifest: r.manifest_json ? safeParse<unknown>(r.manifest_json, undefined) : undefined,
  };
}

function rowToRunCase(r: any): RunCaseRecord {
  return {
    id: r.id,
    run_id: r.run_id,
    case_id: r.case_id,
    case_name: r.case_name,
    category: r.category,
    difficulty: r.difficulty ?? undefined,
    status: r.status,
    started_at: r.started_at,
    ended_at: r.ended_at,
    workdir_path: r.workdir_path,
    transcript_path: r.transcript_path,
    runner_kind: r.runner_kind,
    runner_result: r.runner_result_json ? safeParse(r.runner_result_json, null) : null,
    grader_result: r.grader_result_json ? safeParse(r.grader_result_json, null) : null,
    evaluation: r.evaluation_json ? safeParse(r.evaluation_json, null) : null,
    budget_exceeded: !!r.budget_exceeded,
    error_msg: r.error_msg,
    case_def: safeParse(r.case_def_json, {
      id: r.case_id,
      name: r.case_name,
      category: r.category,
      prompt: "",
      graders: [],
    } as unknown as RunCaseRecord["case_def"]),
    seq: r.seq,
    sample: r.sample ?? 0,
    harness_info: r.harness_info_json ? safeParse(r.harness_info_json, undefined) : undefined,
  };
}
