import Database from "better-sqlite3";
import { DB_PATH, ensureDirs } from "./config";
import type { CaseDefinition, RunCaseRecord, RunRecord, RunSummary } from "./types";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDirs();
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.exec(SCHEMA);
  db = conn;
  return conn;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  params_json TEXT NOT NULL,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS run_cases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  workdir_path TEXT NOT NULL,
  transcript_path TEXT,
  runner_kind TEXT NOT NULL,
  runner_result_json TEXT,
  grader_result_json TEXT,
  evaluation_json TEXT,
  case_def_json TEXT NOT NULL,
  error_msg TEXT,
  seq INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_cases_run ON run_cases(run_id);
CREATE INDEX IF NOT EXISTS idx_run_cases_seq ON run_cases(run_id, seq);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  case_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, at);
`;

export interface RunQuery {
  caseIds?: string[];
  categories?: string[];
  tags?: string[];
}

export function insertRun(run: RunRecord): void {
  getDb().prepare(
    `INSERT INTO runs (id, name, status, created_at, ended_at, params_json, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(run.id, run.name, run.status, run.created_at, run.ended_at ?? null, JSON.stringify(run.params), run.summary ? JSON.stringify(run.summary) : null);
}

export function updateRunStatus(id: string, status: RunRecord["status"], endedAt: number | null, summary: RunSummary | null): void {
  getDb().prepare(
    `UPDATE runs SET status = ?, ended_at = ?, summary_json = ? WHERE id = ?`
  ).run(status, endedAt, summary ? JSON.stringify(summary) : null, id);
}

export function listRuns(limit = 100): RunRecord[] {
  const rows = getDb().prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit) as any[];
  return rows.map(rowToRun);
}

export function getRun(id: string): RunRecord | null {
  const r = getDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as any;
  return r ? rowToRun(r) : null;
}

export function listRunCases(runId: string): RunCaseRecord[] {
  const rows = getDb().prepare(`SELECT * FROM run_cases WHERE run_id = ? ORDER BY seq ASC`).all(runId) as any[];
  return rows.map(rowToRunCase);
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
    `INSERT INTO run_cases (id, run_id, case_id, case_name, category, status, started_at, ended_at, workdir_path, transcript_path, runner_kind, runner_result_json, grader_result_json, evaluation_json, case_def_json, error_msg, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rc.id, rc.run_id, rc.case_id, rc.case_name, rc.category, rc.status,
    rc.started_at, rc.ended_at, rc.workdir_path, rc.transcript_path,
    rc.runner_kind, rc.runner_result ? JSON.stringify(rc.runner_result) : null,
    rc.grader_result ? JSON.stringify(rc.grader_result) : null,
    null, JSON.stringify(rc.case_def), rc.error_msg, rc.seq
  );
}

export function updateRunCase(id: string, patch: Partial<RunCaseRecord>): void {
  const cur = getRunCase(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  getDb().prepare(
    `UPDATE run_cases SET status=?, started_at=?, ended_at=?, transcript_path=?, runner_result_json=?, grader_result_json=?, evaluation_json=?, error_msg=? WHERE id=?`
  ).run(
    next.status, next.started_at, next.ended_at, next.transcript_path,
    next.runner_result ? JSON.stringify(next.runner_result) : null,
    next.grader_result ? JSON.stringify(next.grader_result) : null,
    next.grader_result ? JSON.stringify(next.grader_result) : null,
    next.error_msg, id
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

function rowToRun(r: any): RunRecord {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    created_at: r.created_at,
    ended_at: r.ended_at,
    params: JSON.parse(r.params_json),
    summary: r.summary_json ? JSON.parse(r.summary_json) : null,
  };
}

function rowToRunCase(r: any): RunCaseRecord {
  return {
    id: r.id,
    run_id: r.run_id,
    case_id: r.case_id,
    case_name: r.case_name,
    category: r.category,
    status: r.status,
    started_at: r.started_at,
    ended_at: r.ended_at,
    workdir_path: r.workdir_path,
    transcript_path: r.transcript_path,
    runner_kind: r.runner_kind,
    runner_result: r.runner_result_json ? JSON.parse(r.runner_result_json) : null,
    grader_result: r.grader_result_json ? JSON.parse(r.grader_result_json) : null,
    error_msg: r.error_msg,
    case_def: JSON.parse(r.case_def_json),
    // evaluation_json aliases grader_result for the UI
    ...(r.evaluation_json ? { grader_result: JSON.parse(r.evaluation_json) } : {}),
  };
}