import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { WORKDIRS_DIR } from "./config";
import { appendEvent, insertRun, listRunCases, updateRunStatus } from "./db";
import { executeCase } from "./executor";
import { computeSummary } from "./summary";
import { selectCases } from "./cases";
import type { CaseDefinition, RunnerKind } from "./types";

export interface CreateRunParams {
  name?: string;
  runner: RunnerKind;
  parallel: number;
  model?: string;
  filter?: { caseIds?: string[]; categories?: string[]; tags?: string[] };
}

export async function createAndStartRun(params: CreateRunParams): Promise<{ id: string; caseCount: number }> {
  const id = randomUUID().slice(0, 8);
  const cases = await selectCases(params.filter ?? {});
  if (cases.length === 0) throw new Error("No cases match the filter");

  const run = {
    id,
    name: params.name || `Run ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
    status: "running" as const,
    created_at: Date.now(),
    ended_at: null,
    params: { runner: params.runner, parallel: params.parallel, model: params.model, filter: params.filter },
    summary: null,
  };
  insertRun(run);
  appendEvent(id, "run_started", { case_count: cases.length, runner: params.runner, model: params.model }, undefined);

  void runLoop(id, cases, params.runner, params.parallel, params.model).catch((e) => {
    appendEvent(id, "run_fatal", { error: String(e?.stack || e) }, undefined);
    updateRunStatus(id, "failed", Date.now(), null);
  });

  return { id, caseCount: cases.length };
}

async function runLoop(runId: string, cases: CaseDefinition[], runner: RunnerKind, parallel: number, model?: string) {
  const queue = cases.map((c, i) => ({ def: c, seq: i + 1 }));
  const inflight: Promise<unknown>[] = [];
  const parallelN = Math.max(1, parallel);

  async function worker(): Promise<void> {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await executeCase(runId, item.def, runner, item.seq, model);
    }
  }

  for (let i = 0; i < parallelN; i++) inflight.push(worker());
  await Promise.all(inflight);

  const runCases = listRunCases(runId);
  const summary = computeSummary(runCases);
  updateRunStatus(runId, "completed", Date.now(), summary);
  appendEvent(runId, "run_completed", { pass_rate: summary.passRate, total: summary.total }, undefined);

  // Best-effort cleanup of workdirs after completion (keep last 5 runs)
  try { await cleanupOldWorkdirs(runId, 5); } catch {}
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
  const toDelete = valid.slice(keepLast).filter((v) => v.name !== currentRunId);
  for (const v of toDelete) {
    await fs.rm(path.join(WORKDIRS_DIR, v.name), { recursive: true, force: true }).catch(() => {});
  }
}