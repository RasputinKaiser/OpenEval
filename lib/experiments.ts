import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb, getRun, listRunCases } from "./db";
import type { RunCaseRecord, RunRecord } from "./types";

export interface ExperimentCohortMember {
  caseId: string;
  sample: number;
}

export interface ExperimentInput {
  experimentId?: string;
  hypothesis: string;
  baselineRunId: string;
  candidateRunId: string;
  cohort?: ExperimentCohortMember[];
  originSourceId?: string | null;
  originSessionId?: string | null;
}

export interface ExperimentCaseSnapshot {
  recordId: string;
  caseId: string;
  sample: number;
  caseName: string;
  category: string;
  difficulty: string | null;
  status: string;
  errorMessage: string | null;
  runner: {
    kind: string;
    model: string | null;
    numTurns: number | null;
    durationMs: number | null;
    stopReason: string | null;
    isError: boolean | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    costSource: string | null;
  };
  grading: {
    passed: boolean | null;
    passRatio: number | null;
    durationMs: number | null;
    resultCount: number;
    methods: Array<{
      type: string;
      passed: boolean;
      evidenceTier: string | null;
      judgeSelection: unknown;
      judgeReceipt: unknown;
    }>;
  };
}

export interface ExperimentRunSnapshot {
  runId: string;
  name: string;
  status: string;
  createdAt: number;
  endedAt: number | null;
  configuration: {
    runner: string;
    harness: string | null;
    parallel: number;
    model: string | null;
    samples: number | null;
    filter: unknown;
  };
  judge: unknown;
  summary: unknown;
  cohort: ExperimentCohortMember[];
  cohortDigest: string;
  cases: ExperimentCaseSnapshot[];
  sourceDigest: string;
}

export interface ExperimentSourceState {
  status: "available" | "changed" | "unavailable";
  changed: boolean;
  currentDigest: string | null;
  missingPairs: ExperimentCohortMember[];
}

export interface SavedExperiment {
  experimentId: string;
  hypothesis: string;
  baselineRunId: string;
  candidateRunId: string;
  cohort: ExperimentCohortMember[];
  cohortDigest: string;
  originSourceId: string | null;
  originSessionId: string | null;
  createdAt: number;
  baseline: ExperimentRunSnapshot;
  candidate: ExperimentRunSnapshot;
  sourceStates: { baseline: ExperimentSourceState; candidate: ExperimentSourceState };
}

export interface ExperimentSummary {
  experimentId: string;
  hypothesis: string;
  baselineRunId: string;
  candidateRunId: string;
  cohortCount: number;
  cohortDigest: string;
  originSourceId: string | null;
  originSessionId: string | null;
  createdAt: number;
}

const MAX_BATCH_COHORT = 500;
const MAX_ID = 240;
const MAX_HYPOTHESIS = 4_000;

function dbOrDefault(conn?: Database.Database) { return conn ?? getDb(); }
function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${label} must be a non-empty bounded string.`);
  return value.trim();
}
function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return cleanText(value, label, MAX_ID);
}
function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function cloneJson(value: unknown): unknown {
  if (value === undefined) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function normalizeCohort(value: unknown): ExperimentCohortMember[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_COHORT) throw new Error(`cohort must contain 1 to ${MAX_BATCH_COHORT} case/sample pairs.`);
  const cohort = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`cohort[${index}] must be an object.`);
    const row = item as { caseId?: unknown; sample?: unknown };
    return { caseId: cleanText(row.caseId, `cohort[${index}].caseId`, MAX_ID), sample: nonNegativeInteger(row.sample, `cohort[${index}].sample`) };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId) || a.sample - b.sample);
  const keys = new Set<string>();
  for (const row of cohort) {
    const key = `${row.caseId}\u0000${row.sample}`;
    if (keys.has(key)) throw new Error(`cohort contains duplicate ${row.caseId} sample ${row.sample}.`);
    keys.add(key);
  }
  return cohort;
}
function pairKey(row: ExperimentCohortMember) { return `${row.caseId}\u0000${row.sample}`; }
function allSharedCohort(baseline: RunCaseRecord[], candidate: RunCaseRecord[]): ExperimentCohortMember[] {
  const candidateKeys = new Set(candidate.map((row) => pairKey({ caseId: row.case_id, sample: row.sample ?? 0 })));
  return baseline.map((row) => ({ caseId: row.case_id, sample: row.sample ?? 0 })).filter((row) => candidateKeys.has(pairKey(row))).sort((a, b) => a.caseId.localeCompare(b.caseId) || a.sample - b.sample);
}
function caseMap(rows: RunCaseRecord[]) {
  return new Map(rows.map((row) => [pairKey({ caseId: row.case_id, sample: row.sample ?? 0 }), row]));
}

function caseSnapshot(row: RunCaseRecord): ExperimentCaseSnapshot {
  const runner = row.runner_result as any;
  const usage = runner?.usage;
  const grading = row.evaluation ?? row.grader_result;
  const methods = Array.isArray(grading?.results) ? grading.results.slice(0, 64).map((result: any) => ({
    type: typeof result?.spec?.type === "string" ? result.spec.type : "unknown",
    passed: result?.passed === true,
    evidenceTier: typeof result?.evidenceTier === "string" ? result.evidenceTier : null,
    judgeSelection: cloneJson(result?.judgeSelection),
    judgeReceipt: result?.judgeReceipt ? {
      contract: result.judgeReceipt.contract ?? null,
      version: result.judgeReceipt.version ?? null,
      status: result.judgeReceipt.status ?? null,
      selection: cloneJson(result.judgeReceipt.selection),
      transport: result.judgeReceipt.transport ?? null,
      score: finiteOrNull(result.judgeReceipt.score),
      passed: typeof result.judgeReceipt.passed === "boolean" ? result.judgeReceipt.passed : null,
      reason: typeof result.judgeReceipt.reason === "string" ? result.judgeReceipt.reason.slice(0, 500) : null,
      durationMs: finiteOrNull(result.judgeReceipt.durationMs),
      failure: cloneJson(result.judgeReceipt.failure),
    } : null,
  })) : [];
  const costSource = typeof usage?.costSource === "string" ? usage.costSource : null;
  return {
    recordId: row.id,
    caseId: row.case_id,
    sample: row.sample ?? 0,
    caseName: row.case_name,
    category: row.category,
    difficulty: row.difficulty ?? null,
    status: row.status,
    errorMessage: row.error_msg ?? null,
    runner: {
      kind: row.runner_kind,
      model: typeof runner?.model === "string" ? runner.model : null,
      numTurns: finiteOrNull(runner?.numTurns),
      durationMs: finiteOrNull(runner?.durationMs),
      stopReason: typeof runner?.stopReason === "string" ? runner.stopReason : null,
      isError: typeof runner?.isError === "boolean" ? runner.isError : null,
      inputTokens: finiteOrNull(usage?.inputTokens),
      outputTokens: finiteOrNull(usage?.outputTokens),
      costUsd: costSource === "missing" ? null : finiteOrNull(usage?.costUsd),
      costSource,
    },
    grading: {
      passed: typeof grading?.passed === "boolean" ? grading.passed : null,
      passRatio: finiteOrNull(grading?.passRatio),
      durationMs: finiteOrNull(grading?.durationMs),
      resultCount: Array.isArray(grading?.results) ? grading.results.length : 0,
      methods,
    },
  };
}

function summarySnapshot(summary: RunRecord["summary"]): unknown {
  if (!summary) return null;
  return {
    total: summary.total, passed: summary.passed, failed: summary.failed, errored: summary.errored, skipped: summary.skipped,
    stranded: summary.stranded ?? null, passRate: summary.passRate, passAt1: summary.passAt1 ?? null, passAtK: summary.passAtK ?? null,
    passPowK: summary.passPowK ?? null, samples: summary.samples ?? null, totalCostUsd: summary.totalCostUsd,
    missingCostCases: summary.missingCostCases ?? null, totalTokensIn: summary.totalTokensIn, totalTokensOut: summary.totalTokensOut,
    totalDurationMs: summary.totalDurationMs,
  };
}

function buildSnapshot(run: RunRecord, cases: RunCaseRecord[], cohort: ExperimentCohortMember[]): ExperimentRunSnapshot {
  const byPair = caseMap(cases);
  const selected = cohort.map((pair) => byPair.get(pairKey(pair))).filter((row): row is RunCaseRecord => !!row);
  const snapshotBase = {
    runId: run.id, name: run.name, status: run.status, createdAt: run.created_at, endedAt: run.ended_at,
    configuration: {
      runner: run.params.runner, harness: run.params.harness ?? null, parallel: run.params.parallel,
      model: run.params.model ?? null, samples: run.params.samples ?? null, filter: cloneJson(run.params.filter),
    },
    judge: cloneJson(run.params.judge), summary: summarySnapshot(run.summary), cohort, cohortDigest: digest(cohort),
    cases: selected.map(caseSnapshot),
  };
  return { ...snapshotBase, sourceDigest: digest(snapshotBase) };
}

function snapshotFromRow(row: any): ExperimentSummary {
  return {
    experimentId: row.experiment_id, hypothesis: row.hypothesis, baselineRunId: row.baseline_run_id, candidateRunId: row.candidate_run_id,
    cohortCount: Number(row.cohort_count), cohortDigest: row.cohort_digest, originSourceId: row.origin_source_id, originSessionId: row.origin_session_id, createdAt: Number(row.created_at),
  };
}
function storedSnapshot(row: any, column: "baseline_snapshot_json" | "candidate_snapshot_json"): ExperimentRunSnapshot {
  const value = JSON.parse(row[column]);
  return value as ExperimentRunSnapshot;
}
function sourceState(runId: string, stored: ExperimentRunSnapshot, cohort: ExperimentCohortMember[], conn?: Database.Database): ExperimentSourceState {
  const current = getRun(runId, conn);
  if (!current) return { status: "unavailable", changed: true, currentDigest: null, missingPairs: cohort };
  const cases = listRunCases(runId, conn);
  const map = caseMap(cases);
  const missingPairs = cohort.filter((pair) => !map.has(pairKey(pair)));
  if (missingPairs.length > 0) return { status: "changed", changed: true, currentDigest: null, missingPairs };
  const currentSnapshot = buildSnapshot(current, cases, cohort);
  const changed = currentSnapshot.sourceDigest !== stored.sourceDigest;
  return { status: changed ? "changed" : "available", changed, currentDigest: currentSnapshot.sourceDigest, missingPairs: [] };
}

export function createExperiment(input: ExperimentInput, conn?: Database.Database): SavedExperiment {
  const db = dbOrDefault(conn);
  const hypothesis = cleanText(input.hypothesis, "hypothesis", MAX_HYPOTHESIS);
  const baselineRunId = cleanText(input.baselineRunId, "baselineRunId", MAX_ID);
  const candidateRunId = cleanText(input.candidateRunId, "candidateRunId", MAX_ID);
  if (baselineRunId === candidateRunId) throw new Error("baselineRunId and candidateRunId must differ.");
  const originSourceId = optionalText(input.originSourceId, "originSourceId");
  const originSessionId = optionalText(input.originSessionId, "originSessionId");
  if ((originSourceId && !originSessionId) || (!originSourceId && originSessionId)) throw new Error("originSourceId and originSessionId must be supplied together.");
  const save = db.transaction(() => {
    const baseline = getRun(baselineRunId, db);
    const candidate = getRun(candidateRunId, db);
    if (!baseline || !candidate) throw new Error("Both run IDs must identify existing completed runs.");
    if (baseline.status !== "completed" || candidate.status !== "completed") throw new Error("Both baseline and candidate runs must be completed.");
    const baselineCases = listRunCases(baselineRunId, db);
    const candidateCases = listRunCases(candidateRunId, db);
    const shared = allSharedCohort(baselineCases, candidateCases);
    const cohort = input.cohort === undefined ? (shared.length ? normalizeCohort(shared) : []) : normalizeCohort(input.cohort);
    if (cohort.length === 0) throw new Error("The selected cohort must contain at least one shared case/sample pair.");
    const baselineKeys = new Set(baselineCases.map((row) => pairKey({ caseId: row.case_id, sample: row.sample ?? 0 })));
    const candidateKeys = new Set(candidateCases.map((row) => pairKey({ caseId: row.case_id, sample: row.sample ?? 0 })));
    const missing = cohort.filter((pair) => !baselineKeys.has(pairKey(pair)) || !candidateKeys.has(pairKey(pair)));
    if (missing.length > 0) throw new Error(`Selected cohort contains ${missing.length} pair(s) missing from baseline or candidate.`);
    const experimentId = input.experimentId === undefined ? randomUUID() : cleanText(input.experimentId, "experimentId", MAX_ID);
    const createdAt = Date.now();
    const baselineSnapshot = buildSnapshot(baseline, baselineCases, cohort);
    const candidateSnapshot = buildSnapshot(candidate, candidateCases, cohort);
    const result: SavedExperiment = {
      experimentId, hypothesis, baselineRunId, candidateRunId, cohort, cohortDigest: digest(cohort), originSourceId, originSessionId, createdAt,
      baseline: baselineSnapshot, candidate: candidateSnapshot,
      sourceStates: { baseline: { status: "available", changed: false, currentDigest: baselineSnapshot.sourceDigest, missingPairs: [] }, candidate: { status: "available", changed: false, currentDigest: candidateSnapshot.sourceDigest, missingPairs: [] } },
    };
    db.prepare(`INSERT INTO experiments (experiment_id, hypothesis, baseline_run_id, candidate_run_id, cohort_json, cohort_count, cohort_digest, origin_source_id, origin_session_id, created_at, baseline_snapshot_json, candidate_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(result.experimentId, result.hypothesis, result.baselineRunId, result.candidateRunId, JSON.stringify(result.cohort), result.cohort.length, result.cohortDigest, result.originSourceId, result.originSessionId, result.createdAt, JSON.stringify(result.baseline), JSON.stringify(result.candidate));
    return result;
  });
  return save();
}

export function listExperiments(limit = 50, conn?: Database.Database): ExperimentSummary[] {
  if (!Number.isFinite(limit) || limit < 1) throw new Error("limit must be a positive finite number.");
  const bounded = Math.min(50, Math.floor(limit));
  return (dbOrDefault(conn).prepare("SELECT experiment_id, hypothesis, baseline_run_id, candidate_run_id, cohort_count, cohort_digest, origin_source_id, origin_session_id, created_at FROM experiments ORDER BY created_at DESC, experiment_id ASC LIMIT ?").all(bounded) as any[]).map(snapshotFromRow);
}

export function getExperiment(experimentId: string, conn?: Database.Database): SavedExperiment | null {
  const id = cleanText(experimentId, "experimentId", MAX_ID);
  const row = dbOrDefault(conn).prepare("SELECT * FROM experiments WHERE experiment_id = ?").get(id) as any;
  if (!row) return null;
  const baseline = storedSnapshot(row, "baseline_snapshot_json");
  const candidate = storedSnapshot(row, "candidate_snapshot_json");
  return {
    experimentId: row.experiment_id, hypothesis: row.hypothesis, baselineRunId: row.baseline_run_id, candidateRunId: row.candidate_run_id,
    cohort: JSON.parse(row.cohort_json), cohortDigest: row.cohort_digest, originSourceId: row.origin_source_id, originSessionId: row.origin_session_id, createdAt: Number(row.created_at),
    baseline, candidate,
    sourceStates: { baseline: sourceState(row.baseline_run_id, baseline, baseline.cohort, dbOrDefault(conn)), candidate: sourceState(row.candidate_run_id, candidate, candidate.cohort, dbOrDefault(conn)) },
  };
}
