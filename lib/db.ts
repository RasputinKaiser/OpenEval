import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, ROOT, TRANSCRIPTS_DIR, WORKDIRS_DIR, ensureDirs } from "./config";
import type { RunCaseRecord, RunRecord, RunSummary } from "./types";
import type { RawOutputCapture } from "./runner/raw-output";

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
    // WAL sharply lowers SQLITE_BUSY under the parallel-worker writes this DB
    // sees. On some filesystems (network/overlay mounts) it can't be set and
    // SQLite silently falls back to rollback-journal mode — read back the
    // effective mode and warn rather than let the degraded mode pass unnoticed.
    try { conn.pragma("journal_mode = WAL"); } catch {}
    const journalMode = String(conn.pragma("journal_mode", { simple: true }) ?? "").toLowerCase();
    if (journalMode !== "wal") {
      console.warn(
        `[openeval] eval.db could not enable WAL journal mode (effective mode: ${journalMode || "unknown"}); ` +
        `expect elevated SQLITE_BUSY contention under parallel runs. ` +
        `This usually means the database lives on a filesystem that does not support WAL (e.g. a network/overlay mount).`
      );
    }
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
  raw_output_json TEXT,
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
  { version: 2, apply: () => {} },
  {
    version: 3,
    apply: (conn) => {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS calibration_references (
          reference_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          label TEXT NOT NULL,
          author_label TEXT NOT NULL,
          provenance TEXT NOT NULL,
          source_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          evidence_digest TEXT NOT NULL,
          evidence_version TEXT NOT NULL,
          rubric TEXT NOT NULL,
          outcome TEXT NOT NULL,
          rationale TEXT NOT NULL,
          cited_ids_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (reference_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_calibration_references_created ON calibration_references(created_at DESC);
        CREATE TABLE IF NOT EXISTS calibration_observations (
          record_id TEXT PRIMARY KEY,
          reference_id TEXT NOT NULL,
          reference_version INTEGER NOT NULL,
          provenance TEXT NOT NULL,
          source_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          evidence_digest TEXT NOT NULL,
          evidence_version TEXT NOT NULL,
          rubric TEXT NOT NULL,
          outcome TEXT NOT NULL,
          cited_ids_json TEXT NOT NULL,
          inventory_ids_json TEXT,
          backend TEXT NOT NULL,
          model TEXT NOT NULL,
          reasoning_effort TEXT NOT NULL,
          prompt_version INTEGER NOT NULL,
          cost_usd REAL,
          elapsed_ms REAL,
          created_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_calibration_observations_method ON calibration_observations(backend, model, reasoning_effort, prompt_version);
        CREATE INDEX IF NOT EXISTS idx_calibration_observations_reference ON calibration_observations(reference_id, reference_version);
      `);
    },
  },
  {
    version: 4,
    apply: (conn) => {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS experiments (
          experiment_id TEXT PRIMARY KEY,
          hypothesis TEXT NOT NULL,
          baseline_run_id TEXT NOT NULL,
          candidate_run_id TEXT NOT NULL,
          cohort_json TEXT NOT NULL,
          cohort_count INTEGER NOT NULL,
          cohort_digest TEXT NOT NULL,
          origin_source_id TEXT,
          origin_session_id TEXT,
          created_at INTEGER NOT NULL,
          baseline_snapshot_json TEXT NOT NULL,
          candidate_snapshot_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_experiments_created ON experiments(created_at DESC);
      `);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

/**
 * Run an additive `ADD COLUMN` migration idempotently. We presence-check the
 * column first, but a concurrent process can add it between the check and the
 * ALTER — so a "duplicate column name" error is the one benign race we swallow.
 * Every other failure (disk full, database locked, SQL syntax) means the column
 * is genuinely absent; swallowing it would let later inserts referencing that
 * column throw at runtime with no trace of the root cause. Log and rethrow.
 */
export function runAddColumn(conn: Database.Database, sql: string): void {
  try {
    conn.exec(sql);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("duplicate column name")) return;
    console.error(`[openeval] eval.db migration failed: ${sql} — ${msg}`);
    throw e;
  }
}

function migrate(conn: Database.Database) {
  const runCols = conn.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  const runNames = new Set(runCols.map((c) => c.name));
  if (!runNames.has("manifest_json")) {
    runAddColumn(conn, "ALTER TABLE runs ADD COLUMN manifest_json TEXT");
  }

  const cols = conn.prepare("PRAGMA table_info(run_cases)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const add = (col: string, decl: string) => {
    if (!names.has(col)) { runAddColumn(conn, `ALTER TABLE run_cases ADD COLUMN ${col} ${decl}`); }
  };
  add("difficulty", "TEXT");
  add("budget_exceeded", "INTEGER DEFAULT 0");
  add("sample", "INTEGER DEFAULT 0");
  add("harness_info_json", "TEXT");
  add("raw_output_json", "TEXT");

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

export type StorageInventoryStatus = "measured" | "missing" | "partial";

export interface StorageInventoryEntry {
  id: "eval-db" | "live-cache" | "transcripts" | "workdirs" | "reports" | "settings";
  label: string;
  path: string;
  bytes: number;
  files: number;
  directories: number;
  status: StorageInventoryStatus;
  retention: string;
}

export interface StorageInventory {
  generatedAt: number;
  totalBytes: number;
  complete: boolean;
  entries: StorageInventoryEntry[];
  warnings: string[];
}

type InventoryTarget = {
  id: StorageInventoryEntry["id"];
  label: string;
  path: string;
  kind: "files" | "directory";
  retention: string;
};

type InventoryMeasurement = Pick<StorageInventoryEntry, "bytes" | "files" | "directories" | "status"> & { warnings: string[] };

const STORAGE_INVENTORY_ENTRY_CAP = 100_000;
const STORAGE_INVENTORY_DEPTH_CAP = 64;

const INVENTORY_TARGETS: InventoryTarget[] = [
  {
    id: "eval-db",
    label: "Evaluation database",
    path: DB_PATH,
    kind: "files",
    retention: "Run rows and events are retained; workdir cleanup does not remove them.",
  },
  {
    id: "live-cache",
    label: "Live parsed cache",
    path: path.join(ROOT, "data", "live-cache.db"),
    kind: "files",
    retention: "Rebuildable parsed summaries; removing the cache would force a re-parse, not remove raw transcripts.",
  },
  {
    id: "transcripts",
    label: "Raw transcripts",
    path: TRANSCRIPTS_DIR,
    kind: "directory",
    retention: "Raw transcript JSONL is retained independently of workdir cleanup and is not changed by this inventory.",
  },
  {
    id: "workdirs",
    label: "Run workdirs",
    path: WORKDIRS_DIR,
    kind: "directory",
    retention: "Terminal evidence; automatic cleanup keeps the five most recent run groups.",
  },
  {
    id: "reports",
    label: "Report bundles",
    path: path.join(ROOT, "data", "reports"),
    kind: "directory",
    retention: "Generated reports survive workdir cleanup and are not changed by this inventory.",
  },
  {
    id: "settings",
    label: "Saved settings",
    path: path.join(ROOT, "data", "settings.json"),
    kind: "files",
    retention: "Small local judge-setting metadata file.",
  },
];

function fileSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function measureFileSet(paths: string[]): InventoryMeasurement {
  let bytes = 0;
  let files = 0;
  const warnings: string[] = [];
  for (const filePath of paths) {
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        warnings.push(`Skipped non-regular storage entry: ${filePath}`);
        continue;
      }
      bytes += stat.size;
      files += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        warnings.push(`Could not stat storage entry ${filePath}: ${String((error as Error)?.message ?? error)}`);
      }
    }
  }
  return {
    bytes,
    files,
    directories: 0,
    status: warnings.length ? "partial" : files ? "measured" : "missing",
    warnings,
  };
}

function measureDirectory(root: string): InventoryMeasurement {
  let bytes = 0;
  let files = 0;
  let directories = 0;
  let visited = 0;
  const warnings: string[] = [];

  try {
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return {
        bytes: 0,
        files: 0,
        directories: 0,
        status: "partial",
        warnings: [`Skipped non-directory storage root: ${root}`],
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { bytes: 0, files: 0, directories: 0, status: "missing", warnings: [] };
    }
    return {
      bytes: 0,
      files: 0,
      directories: 0,
      status: "partial",
      warnings: [`Could not stat storage directory ${root}: ${String((error as Error)?.message ?? error)}`],
    };
  }

  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch (error) {
      warnings.push((error as NodeJS.ErrnoException)?.code === "ENOENT"
        ? `Storage directory disappeared during inventory: ${current.directory}`
        : `Could not read storage directory ${current.directory}: ${String((error as Error)?.message ?? error)}`);
      continue;
    }

    for (const child of children) {
      visited += 1;
      if (visited > STORAGE_INVENTORY_ENTRY_CAP) {
        warnings.push(`Storage inventory stopped after ${STORAGE_INVENTORY_ENTRY_CAP.toLocaleString()} entries; byte totals are a lower bound.`);
        return { bytes, files, directories, status: "partial", warnings };
      }
      const childPath = path.join(current.directory, child.name);
      if (child.isSymbolicLink()) {
        warnings.push(`Skipped symbolic link during storage inventory: ${childPath}`);
        continue;
      }
      if (child.isDirectory()) {
        directories += 1;
        if (current.depth >= STORAGE_INVENTORY_DEPTH_CAP) {
          warnings.push(`Storage inventory depth cap reached at ${childPath}; byte totals are a lower bound.`);
          continue;
        }
        stack.push({ directory: childPath, depth: current.depth + 1 });
        continue;
      }
      if (!child.isFile()) continue;
      try {
        bytes += fs.lstatSync(childPath).size;
        files += 1;
      } catch (error) {
        warnings.push(`Could not stat storage entry ${childPath}: ${String((error as Error)?.message ?? error)}`);
      }
    }
  }

  return {
    bytes,
    files,
    directories,
    status: warnings.length ? "partial" : files || directories ? "measured" : "missing",
    warnings,
  };
}

export function getStorageInventory(): StorageInventory {
  const warnings: string[] = [];
  const entries = INVENTORY_TARGETS.map((target) => {
    const measurement = target.kind === "files"
      ? measureFileSet([target.path, `${target.path}-wal`, `${target.path}-shm`].filter((candidate) => target.id !== "settings" || candidate === target.path))
      : measureDirectory(target.path);
    warnings.push(...measurement.warnings);
    return {
      id: target.id,
      label: target.label,
      path: target.path,
      bytes: measurement.bytes,
      files: measurement.files,
      directories: measurement.directories,
      status: measurement.status,
      retention: target.retention,
    } satisfies StorageInventoryEntry;
  });
  return {
    generatedAt: Date.now(),
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    complete: entries.every((entry) => entry.status !== "partial"),
    entries,
    warnings,
  };
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

export const PERSISTED_TRANSCRIPT_CAP = 240;
export const PERSISTED_TOOL_CALL_CAP = 128;
export const PERSISTED_TOKEN_SEGMENT_CAP = 256;
export const PERSISTED_TEXT_CAP = 4_000;
export const PERSISTED_TOOL_TEXT_CAP = 2_000;
export const PERSISTED_GRADER_RESULT_CAP = 64;
export const PERSISTED_GRADER_TEXT_CAP = 4_000;
function boundedText(value: unknown, max = PERSISTED_TEXT_CAP): string { return typeof value === "string" ? value.slice(0, max) : String(value ?? ""); }
function boundedJson(value: unknown, max = PERSISTED_TOOL_TEXT_CAP): unknown { if (typeof value === "string") return value.slice(0, max); try { const json = JSON.stringify(value); return !json || json.length <= max ? value : json.slice(0, max) + "…[projection truncated]"; } catch { return "[unserializable projection]"; } }
export function boundRunnerResult(result: any): any {
  if (!result || typeof result !== "object") return null;
  return { ...result, rawJson: null, rawOutput: undefined,
    transcript: Array.isArray(result.transcript) ? result.transcript.slice(0, PERSISTED_TRANSCRIPT_CAP).map((e: any) => ({ role: e?.role, uuid: boundedText(e?.uuid, 256), atMs: e?.atMs, textLen: e?.textLen, content: Array.isArray(e?.content) ? e.content.slice(0, 8).map((b: any) => ({ type: b?.type, id: b?.id, name: b?.name, text: b?.text === undefined ? undefined : boundedText(b.text, PERSISTED_TOOL_TEXT_CAP), input: b?.input === undefined ? undefined : boundedJson(b.input), tool_use_id: b?.tool_use_id, content: b?.content === undefined ? undefined : boundedText(b.content, PERSISTED_TOOL_TEXT_CAP), is_error: b?.is_error })) : [] })) : [],
    toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls.slice(0, PERSISTED_TOOL_CALL_CAP).map((t: any) => ({ id: boundedText(t?.id, 256), name: boundedText(t?.name, 256), input: t?.input === undefined ? undefined : boundedJson(t.input), output: t?.output === undefined ? undefined : boundedText(t.output, PERSISTED_TOOL_TEXT_CAP), isError: !!t?.isError, atMs: t?.atMs, durationMs: t?.durationMs })) : [],
    finalText: boundedText(result.finalText), resultText: boundedText(result.resultText), tokenSegments: Array.isArray(result.tokenSegments) ? result.tokenSegments.slice(0, PERSISTED_TOKEN_SEGMENT_CAP) : [], toolCallCounts: Object.fromEntries(Object.entries(result.toolCallCounts ?? {}).slice(0, PERSISTED_TOOL_CALL_CAP).map(([k, v]) => [boundedText(k, 256), Number(v) || 0])) };
}
export function boundEvaluation(evaluation: any): any { if (!evaluation || typeof evaluation !== "object") return null; return { passed: !!evaluation.passed, passRatio: Number(evaluation.passRatio) || 0, durationMs: Number(evaluation.durationMs) || 0, results: Array.isArray(evaluation.results) ? evaluation.results.slice(0, PERSISTED_GRADER_RESULT_CAP).map((r: any) => ({ ...r, detail: boundedText(r?.detail, 1_000), output: r?.output === undefined ? undefined : boundedText(r.output, PERSISTED_GRADER_TEXT_CAP), spec: r?.spec })) : [] }; }

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

export function getRun(id: string, conn?: Database.Database): RunRecord | null {
  const r = (conn ?? getDb()).prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as any;
  return r ? rowToRun(r) : null;
}

export function getRunStatus(id: string): RunRecord["status"] | null {
  return (getDb().prepare(`SELECT status FROM runs WHERE id = ?`).pluck().get(id) as RunRecord["status"] | undefined) ?? null;
}

export function listRunsByStatus(status: RunRecord["status"]): RunRecord[] {
  const rows = getDb().prepare(`SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC`).all(status) as any[];
  return rows.map(rowToRun);
}

export function listRunCases(runId: string, conn?: Database.Database): RunCaseRecord[] {
  const rows = (conn ?? getDb()).prepare(`SELECT * FROM run_cases WHERE run_id = ? ORDER BY seq ASC`).all(runId) as any[];
  return rows.map(rowToRunCase);
}

export interface RunCaseSummary {
  case_id: string;
  category: string | null;
  sample: number;
  model: string | null;
  status: string;
  runner_cost_usd: number | null;
  runner_cost_source: "measured" | "inferred" | "unspecified" | "missing";
  runner_input_tokens: number | null;
  runner_output_tokens: number | null;
  runner_duration_ms: number | null;
  runner_duration_source: "measured" | "inferred" | "unspecified" | "missing";
}

function finiteMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function metricSource(value: unknown): "measured" | "inferred" | "unspecified" | "missing" {
  return value === "measured" || value === "inferred" || value === "unspecified" || value === "missing"
    ? value
    : "unspecified";
}

export function getRunCaseSummariesBatch(runIds: string[]): Map<string, RunCaseSummary[]> {
  if (runIds.length === 0) return new Map();
  const placeholders = runIds.map(() => "?").join(",");
  const rows = getDb().prepare(
    `SELECT run_id, case_id, category, sample, status, runner_result_json FROM run_cases WHERE run_id IN (${placeholders}) ORDER BY seq ASC`
  ).all(...runIds) as any[];
  const result = new Map<string, RunCaseSummary[]>();
  for (const row of rows) {
    let parsed: any = null;
    try { parsed = JSON.parse(row.runner_result_json); } catch {}
    const usage = parsed?.usage;
    const cost = finiteMetric(usage?.costUsd);
    const costSource = metricSource(usage?.costSource ?? (cost === null ? "missing" : "unspecified"));
    const duration = finiteMetric(parsed?.durationMs);
    const durationSource = metricSource(parsed?.durationSource ?? (duration === null ? "missing" : "measured"));
    const summary: RunCaseSummary = {
      case_id: String(row.case_id ?? ""),
      category: typeof row.category === "string" && row.category ? row.category : null,
      sample: Number.isFinite(Number(row.sample)) ? Number(row.sample) : 0,
      model: typeof parsed?.model === "string" && parsed.model.trim() ? parsed.model : null,
      status: row.status,
      runner_cost_usd: costSource === "missing" ? null : cost,
      runner_cost_source: costSource,
      runner_input_tokens: finiteMetric(usage?.inputTokens),
      runner_output_tokens: finiteMetric(usage?.outputTokens),
      runner_duration_ms: durationSource === "missing" ? null : duration,
      runner_duration_source: durationSource,
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
    `INSERT INTO run_cases (id, run_id, case_id, case_name, category, difficulty, status, started_at, ended_at, workdir_path, transcript_path, raw_output_json, runner_kind, runner_result_json, grader_result_json, evaluation_json, budget_exceeded, case_def_json, error_msg, seq, sample, harness_info_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rc.id, rc.run_id, rc.case_id, rc.case_name, rc.category, rc.difficulty ?? null, rc.status,
    rc.started_at, rc.ended_at, rc.workdir_path, rc.transcript_path,
    rc.raw_output ? JSON.stringify(rc.raw_output) : null, rc.runner_kind, rc.runner_result ? JSON.stringify(boundRunnerResult(rc.runner_result)) : null,
    rc.grader_result ? JSON.stringify(boundEvaluation(rc.grader_result)) : null, rc.evaluation ? JSON.stringify(boundEvaluation(rc.evaluation)) : null, rc.budget_exceeded ? 1 : 0, JSON.stringify(rc.case_def), rc.error_msg, rc.seq, rc.sample ?? 0,
    rc.harness_info ? JSON.stringify(rc.harness_info) : null
  );
}

export function updateRunCase(id: string, patch: Partial<RunCaseRecord>): void {
  const cur = getRunCase(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  getDb().prepare(
    `UPDATE run_cases SET status=?, started_at=?, ended_at=?, transcript_path=?, raw_output_json=?, runner_result_json=?, grader_result_json=?, evaluation_json=?, budget_exceeded=?, error_msg=?, harness_info_json=? WHERE id=?`
  ).run(
    next.status, next.started_at, next.ended_at, next.transcript_path,
    next.raw_output ? JSON.stringify(next.raw_output) : null, next.runner_result ? JSON.stringify(boundRunnerResult(next.runner_result)) : null,
    next.grader_result ? JSON.stringify(boundEvaluation(next.grader_result)) : null, next.evaluation ? JSON.stringify(boundEvaluation(next.evaluation)) : null,
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

/** Cursor just before the latest bounded activity window for a run. */
export function recentEventCursor(runId: string, limit = 200): number {
  const row = getDb().prepare(`SELECT id FROM events WHERE run_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?`).get(runId, Math.max(0, limit - 1)) as { id?: number } | undefined;
  return typeof row?.id === "number" ? Math.max(0, row.id - 1) : 0;
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
    raw_output: r.raw_output_json ? safeParse<RawOutputCapture | undefined>(r.raw_output_json, undefined) : undefined,
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
