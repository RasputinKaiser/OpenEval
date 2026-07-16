import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { WORKDIRS_DIR } from "./config";
import { appendEvent, getLastEventAt, getRun, getRunCaseBySeq, getRunStatus, insertRun, insertRunCase, listRunCases, listRunsByStatus, updateRunCase, updateRunManifest, updateRunStatus } from "./db";
import { executeCase } from "./executor";
import { computeSummary } from "./summary";
import { selectCases } from "./cases";
import { getDefaultHarness } from "./adapters/registry";
import { collectRunManifest } from "./manifest";
import type { CaseDefinition, RunnerKind } from "./types";
import { isTerminalCaseStatus } from "./status";
import { resolveDefaultModel } from "./models";

// In-process cancellation fast path. The run row's status in SQLite is the
// source of truth — dev HMR can reset this module (and this Map) mid-run, so
// the loop also re-checks the DB between cases and the cancel route writes
// the DB before flagging the registry.
const cancelRegistry = new Map<string, { cancelled: boolean }>();

export function requestRunCancel(runId: string): boolean {
  const entry = cancelRegistry.get(runId);
  if (entry) entry.cancelled = true;
  return !!entry;
}

export interface CreateRunParams {
  name?: string;
  runner: RunnerKind;
  harness?: string;
  parallel: number;
  model?: string;
  samples?: number;
  filter?: { caseIds?: string[]; categories?: string[]; tags?: string[]; difficulty?: string[] };
}

export async function createAndStartRun(params: CreateRunParams): Promise<{ id: string; caseCount: number }> {
  const id = randomUUID().slice(0, 8);
  const cases = await selectCases(params.filter ?? {});
  if (cases.length === 0) throw new Error("No cases match the filter");
  const samples = Math.max(1, Math.min(params.samples ?? 1, 8));
  const harness = params.harness || getDefaultHarness();
  const resolvedDefault = resolveDefaultModel(harness);
  const model = params.model || resolvedDefault.id;

  const run = {
    id,
    name: params.name || `Run ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
    status: "running" as const,
    created_at: Date.now(),
    ended_at: null,
    params: { runner: params.runner, harness, parallel: params.parallel, model, samples, filter: params.filter },
    summary: null,
  };
  insertRun(run);
  void collectRunManifest(harness, model, { harnessWasDefault: !params.harness, modelWasDefault: !params.model, modelDefaultSource: resolvedDefault.source })
    .then((m) => updateRunManifest(id, m))
    .catch(() => {});
  appendEvent(id, "run_started", { case_count: cases.length, samples, runner: params.runner, harness, model }, undefined);

  void runLoop(id, cases, params.runner, harness, params.parallel, model, samples).catch((e) => {
    appendEvent(id, "run_fatal", { error: String(e?.stack || e) }, undefined);
    updateRunStatus(id, "failed", Date.now(), null);
  });

  return { id, caseCount: cases.length * samples };
}

async function runLoop(runId: string, cases: CaseDefinition[], runner: RunnerKind, harness: string, parallel: number, model?: string, samples = 1) {
  const cancelState = { cancelled: false };
  cancelRegistry.set(runId, cancelState);
  // Tool calls and grader processes can legitimately be quiet for longer than
  // the orphan threshold. A DB heartbeat survives HMR module replacement and
  // is the liveness proof used by sweepOrphanRuns.
  const heartbeat = setInterval(() => {
    try { appendEvent(runId, "run_heartbeat", {}, undefined); } catch {}
  }, 60_000);
  heartbeat.unref?.();
  try {
    await runLoopBody(runId, cases, runner, harness, parallel, cancelState, model, samples);
  } finally {
    clearInterval(heartbeat);
    cancelRegistry.delete(runId);
  }
}

async function runLoopBody(runId: string, cases: CaseDefinition[], runner: RunnerKind, harness: string, parallel: number, cancelState: { cancelled: boolean }, model?: string, samples = 1) {
  const work: Array<{ def: CaseDefinition; seq: number; sample: number }> = [];
  let seq = 0;
  for (const def of cases) {
    for (let s = 0; s < samples; s++) {
      work.push({ def, seq: ++seq, sample: s });
    }
  }
  const inflight: Promise<unknown>[] = [];
  const parallelN = Math.max(1, parallel);

  const isCancelled = (): boolean => {
    if (cancelState.cancelled) return true;
    // The cancel route (or orphan sweep) may have marked the run aborted from
    // a module instance that can't see our registry — the DB row decides.
    try {
      if (getRunStatus(runId) === "aborted") cancelState.cancelled = true;
    } catch {}
    return cancelState.cancelled;
  };

  async function worker(): Promise<void> {
    while (work.length) {
      if (isCancelled()) break;
      const item = work.shift();
      if (!item) break;
      try {
        await executeCase(runId, item.def, runner, item.seq, model, item.sample, harness);
      } catch (e: any) {
        // Defense in depth: executeCase records its own failures, but never let
        // one case's unexpected throw reject the pool and abort the whole run.
        appendEvent(runId, "case_error", { case_id: item.def.id, seq: item.seq, sample: item.sample, error: String(e?.stack || e) }, item.def.id);
        // The event alone leaves the ROW at running/grading forever — land a
        // terminal status so the summary can count this case honestly.
        try {
          const row = getRunCaseBySeq(runId, item.seq);
          if (row && !isTerminalCaseStatus(row.status)) {
            updateRunCase(row.id, { status: "error", ended_at: Date.now(), error_msg: `Worker caught: ${String(e?.stack || e).slice(0, 500)}` });
          }
        } catch {}
      }
    }
  }

  for (let i = 0; i < parallelN; i++) inflight.push(worker());
  await Promise.all(inflight);

  // Cancelled: queued cases never got rows — record them as skipped so the
  // summary accounts for every unit of planned work.
  if (isCancelled() && work.length) {
    const now = Date.now();
    for (const item of work.splice(0)) {
      try {
        insertRunCase({
          id: randomUUID(),
          run_id: runId,
          case_id: item.def.id,
          case_name: item.def.name,
          category: item.def.category,
          difficulty: item.def.difficulty,
          status: "skipped",
          started_at: null,
          ended_at: now,
          workdir_path: path.join(WORKDIRS_DIR, runId, `${item.def.id}__s${item.sample}`),
          transcript_path: null,
          runner_kind: runner,
          runner_result: null,
          grader_result: null,
          evaluation: null,
          budget_exceeded: false,
          error_msg: "cancelled",
          case_def: item.def,
          seq: item.seq,
          sample: item.sample,
        });
      } catch {}
    }
  }

  // Terminal-status invariant: every case of a finished run must be
  // passed/failed/error/skipped. Sweep anything the workers lost (e.g. a DB
  // write that failed mid-case) into "error" before the summary is computed.
  const runCases = listRunCases(runId);
  for (const rc of runCases) {
    if (!isTerminalCaseStatus(rc.status)) {
      try {
        updateRunCase(rc.id, { status: "error", ended_at: Date.now(), error_msg: rc.error_msg || "Stranded: case never reached a terminal status" });
        rc.status = "error";
        rc.ended_at = Date.now();
        rc.error_msg ||= "Stranded: case never reached a terminal status";
      } catch {}
    }
  }

  const summary = computeSummary(runCases);
  const cancelled = isCancelled();
  updateRunStatus(runId, cancelled ? "aborted" : "completed", Date.now(), summary);
  if (cancelled) {
    appendEvent(runId, "run_aborted", { reason: "cancelled", skipped: summary.skipped, total: summary.total }, undefined);
  } else {
    appendEvent(runId, "run_completed", { pass_rate: summary.passRate, pass_at_1: summary.passAt1, pass_at_k: summary.passAtK, pass_pow_k: summary.passPowK, total: summary.total }, undefined);
  }

  try { await cleanupOldWorkdirs(runId, 5); } catch {}
}

const ORPHAN_EVENT_AGE_MS = 10 * 60 * 1000;

// A dev-server recompile or crash strands runs at "running" forever, keeping
// SSE and client polls alive indefinitely. Any run with no live loop in this
// process and no event activity for 10+ minutes gets closed out as aborted.
// Called from GET /api/runs/[id] so stale runs self-heal when viewed.
export function sweepOrphanRuns(): number {
  let swept = 0;
  for (const run of listRunsByStatus("running")) {
    if (cancelRegistry.has(run.id)) continue;
    const lastActivity = getLastEventAt(run.id) ?? run.created_at;
    if (Date.now() - lastActivity < ORPHAN_EVENT_AGE_MS) continue;
    const runCases = listRunCases(run.id);
    for (const rc of runCases) {
      if (!isTerminalCaseStatus(rc.status)) {
        try {
          updateRunCase(rc.id, { status: "error", ended_at: Date.now(), error_msg: rc.error_msg || "orphaned" });
          rc.status = "error";
          rc.ended_at = Date.now();
          rc.error_msg ||= "orphaned";
        } catch {}
      }
    }
    const summary = computeSummary(runCases);
    updateRunStatus(run.id, "aborted", Date.now(), summary);
    appendEvent(run.id, "run_aborted", { reason: "orphaned" }, undefined);
    swept++;
  }
  return swept;
}

const orphanSweepState = (() => {
  const key = "__openevalOrphanSweep";
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  if (!root[key]) root[key] = { lastAt: 0 };
  return root[key] as { lastAt: number };
})();

/** Polling clients may hit the route every second; the orphan threshold is ten minutes. */
export function sweepOrphanRunsIfDue(intervalMs = 60_000): number {
  const now = Date.now();
  if (now - orphanSweepState.lastAt < intervalMs) return 0;
  orphanSweepState.lastAt = now;
  return sweepOrphanRuns();
}

async function cleanupOldWorkdirs(currentRunId: string, keepLast: number) {
  let entries: string[];
  try { entries = await fs.readdir(WORKDIRS_DIR); } catch { return; }
  const stamped = await Promise.all(entries.map(async (name) => {
    const stat = await fs.stat(path.join(WORKDIRS_DIR, name)).catch(() => null);
    return stat ? { name, mtime: stat.mtime.getTime() } : null;
  }));
  const valid = stamped.filter((x): x is { name: string; mtime: number } => !!x);
  valid.sort((a, b) => b.mtime - a.mtime);
  // Never delete the current run's workdir NOR any run still marked running —
  // parallel runs are legal and their workdirs are live.
  const toDelete = valid.slice(keepLast).filter((v) => {
    if (v.name === currentRunId) return false;
    try { if (getRun(v.name)?.status === "running") return false; } catch {}
    return true;
  });
  for (const v of toDelete) {
    await fs.rm(path.join(WORKDIRS_DIR, v.name), { recursive: true, force: true }).catch(() => {});
  }
}
