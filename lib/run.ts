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
  samples?: number;
  filter?: { caseIds?: string[]; categories?: string[]; tags?: string[]; difficulty?: string[] };
}

export async function createAndStartRun(params: CreateRunParams): Promise<{ id: string; caseCount: number }> {
  const id = randomUUID().slice(0, 8);
  const cases = await selectCases(params.filter ?? {});
  if (cases.length === 0) throw new Error("No cases match the filter");
  const samples = Math.max(1, Math.min(params.samples ?? 1, 8));
  const model = params.model || "glm-5.2";

  const run = {
    id,
    name: params.name || `Run ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
    status: "running" as const,
    created_at: Date.now(),
    ended_at: null,
    params: { runner: params.runner, parallel: params.parallel, model, samples, filter: params.filter },
    summary: null,
  };
  insertRun(run);
  appendEvent(id, "run_started", { case_count: cases.length, samples, runner: params.runner, model }, undefined);

  void runLoop(id, cases, params.runner, params.parallel, model, samples).catch((e) => {
    appendEvent(id, "run_fatal", { error: String(e?.stack || e) }, undefined);
    updateRunStatus(id, "failed", Date.now(), null);
  });

  return { id, caseCount: cases.length * samples };
}

async function runLoop(runId: string, cases: CaseDefinition[], runner: RunnerKind, parallel: number, model?: string, samples = 1) {
  const work: Array<{ def: CaseDefinition; seq: number; sample: number }> = [];
  let seq = 0;
  for (const def of cases) {
    for (let s = 0; s < samples; s++) {
      work.push({ def, seq: ++seq, sample: s });
    }
  }
  const inflight: Promise<unknown>[] = [];
  const parallelN = Math.max(1, parallel);

  async function worker(): Promise<void> {
    while (work.length) {
      const item = work.shift();
      if (!item) break;
      await executeCase(runId, item.def, runner, item.seq, model, item.sample);
    }
  }

  for (let i = 0; i < parallelN; i++) inflight.push(worker());
  await Promise.all(inflight);

  const runCases = listRunCases(runId);
  const summary = computeSummary(runCases);
  updateRunStatus(runId, "completed", Date.now(), summary);
  appendEvent(runId, "run_completed", { pass_rate: summary.passRate, pass_at_1: summary.passAt1, pass_at_k: summary.passAtK, pass_pow_k: summary.passPowK, total: summary.total }, undefined);

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