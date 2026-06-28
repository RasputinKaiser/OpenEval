import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FIXTURES_DIR, TRANSCRIPTS_DIR, WORKDIRS_DIR } from "./config";
import { appendEvent, insertRunCase, updateRunCase } from "./db";
import { runGrader, evaluate } from "./grader";
import { getRunner } from "./runner";
import { getAdapter } from "./adapters/registry";
import { discoverHarnesses } from "./adapters/discover";
import type { CaseDefinition, RunCaseRecord, RunnerKind, RunnerResult } from "./types";

export async function prepareWorkdir(runId: string, caseId: string, def: CaseDefinition, sample: number): Promise<{ dir: string; fixtureSrc?: string }> {
  const dir = path.join(WORKDIRS_DIR, runId, `${caseId}__s${sample}`);
  await fs.mkdir(dir, { recursive: true });
  const setup = def.setup;
  let fixtureSrc: string | undefined;
  if (!setup || setup.type === "none") return { dir };
  if (setup.type === "fixture" && setup.fixture) {
    fixtureSrc = path.resolve(FIXTURES_DIR, setup.fixture);
    await copyDir(fixtureSrc, dir);
  } else if (setup.type === "git-clone" && setup.repo) {
    const { execSync } = await import("node:child_process");
    execSync(`git clone --depth 1 ${setup.repo} .`, { cwd: dir, stdio: "pipe" });
  }
  if (setup.init_git) {
    const { execSync } = await import("node:child_process");
    try {
      execSync("git init -q && git add -A && git -c user.email=eval@local -c user.name=eval commit -q -m baseline", { cwd: dir, stdio: "pipe" });
    } catch {}
  }
  return { dir, fixtureSrc };
}

async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await fs.mkdir(d, { recursive: true });
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

function transcriptToText(r: RunnerResult): string {
  const lines: string[] = [];
  for (const m of r.transcript) {
    if (m.role === "assistant") {
      for (const b of m.content) {
        if (b.type === "text") lines.push(`ASSISTANT: ${b.text}`);
        else if (b.type === "tool_use") lines.push(`TOOL_USE(${b.name}): ${JSON.stringify(b.input).slice(0, 400)}`);
      }
    } else if (m.role === "user") {
      for (const b of m.content) {
        if (b.type === "tool_result") lines.push(`TOOL_RESULT(${b.tool_use_id}): ${b.content.slice(0, 400)}`);
      }
    }
  }
  return lines.join("\n");
}

export async function executeCase(
  runId: string,
  def: CaseDefinition,
  runnerKind: RunnerKind,
  seq: number,
  modelOverride?: string,
  sample: number = 0,
  harness?: string,
): Promise<RunCaseRecord> {
  const rcId = randomUUID();
  const { dir: workdir, fixtureSrc } = await prepareWorkdir(runId, def.id, def, sample);
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${runId}_${def.id}__s${sample}.jsonl`);

  const rec: RunCaseRecord & { seq: number } = {
    id: rcId,
    run_id: runId,
    case_id: def.id,
    case_name: def.name,
    category: def.category,
    difficulty: def.difficulty,
    status: "running",
    started_at: Date.now(),
    ended_at: null,
    workdir_path: workdir,
    transcript_path: transcriptPath,
    runner_kind: runnerKind,
    runner_result: null,
    grader_result: null,
    evaluation: null,
    budget_exceeded: false,
    error_msg: null,
    case_def: def,
    seq,
    sample,
  };
  insertRunCase(rec);
  appendEvent(runId, "case_started", { case_id: def.id, seq, sample, name: def.name, category: def.category, difficulty: def.difficulty }, def.id);

  const runner = getRunner(runnerKind);
  const runnerCfg = def.runner || {};
  const adapter = getAdapter(harness);
  let harnessInfo: { id: string; bin: string | null; version: string | null } | undefined;
  if (harness) {
    try {
      const discovered = await discoverHarnesses();
      const hit = discovered.find((h) => h.id === adapter.id);
      harnessInfo = hit ? { id: adapter.id, bin: hit.bin, version: hit.version } : { id: adapter.id, bin: null, version: null };
    } catch {
      harnessInfo = { id: adapter.id, bin: null, version: null };
    }
  }
  rec.harness_info = harnessInfo;
  const ctx = {
    caseId: def.id,
    workdir,
    prompt: def.prompt,
    maxTurns: runnerCfg.max_turns ?? 25,
    timeoutMs: (runnerCfg.timeout_seconds ?? 300) * 1000,
    permissionMode: runnerCfg.permission_mode ?? "bypassPermissions",
    model: modelOverride || runnerCfg.model,
    extraArgs: runnerCfg.extra_args ?? [],
    harness,
    onEvent: (ev: any) => {
      void fs.appendFile(transcriptPath, JSON.stringify(ev) + "\n").catch(() => {});
      if (ev.kind === "tool_use") appendEvent(runId, "tool_use", { case_id: def.id, sample, tool: ev.tool, id: ev.id }, def.id);
      else if (ev.kind === "tool_result") appendEvent(runId, "tool_result", { case_id: def.id, sample, id: ev.id, error: ev.isError }, def.id);
      else if (ev.kind === "message") appendEvent(runId, "assistant_message", { case_id: def.id, sample, text: (ev.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").slice(0, 200)) }, def.id);
    },
  };

  let runnerResult: RunnerResult;
  try {
    runnerResult = await runner.run(ctx);
  } catch (e: any) {
    runnerResult = {
      exitCode: 1,
      durationMs: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
      transcript: [],
      toolCalls: [],
      finalText: "",
      resultText: "",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
      numTurns: 0,
      stopReason: null,
      sessionId: null,
      model: modelOverride || runnerCfg.model || null,
      isError: true,
      rawJson: null,
      tokenSegments: [],
      toolCallCounts: {},
    };
    rec.error_msg = `Runner threw: ${String(e?.stack || e)}`;
  }

  if (def.budget) {
    const overCost = def.budget.max_cost_usd != null && runnerResult.usage.costUsd > def.budget.max_cost_usd;
    const overTurns = def.budget.max_turns != null && runnerResult.numTurns > def.budget.max_turns;
    if (overCost || overTurns) {
      rec.budget_exceeded = true;
      const reasons = [overCost ? `cost $${runnerResult.usage.costUsd.toFixed(4)} > $${def.budget.max_cost_usd}` : null, overTurns ? `turns ${runnerResult.numTurns} > ${def.budget.max_turns}` : null].filter(Boolean).join("; ");
      rec.error_msg = (rec.error_msg ? rec.error_msg + " | " : "") + `Budget exceeded: ${reasons}`;
    }
  }

  rec.runner_result = runnerResult;
  rec.status = "grading";
  updateRunCase(rcId, { status: "grading", runner_result: runnerResult, budget_exceeded: rec.budget_exceeded, error_msg: rec.error_msg });
  appendEvent(runId, "case_grading", { case_id: def.id, sample, duration_ms: runnerResult.durationMs }, def.id);

  try {
    const transcriptText = transcriptToText(runnerResult);
    const graderResults = [];
    for (const spec of def.graders) {
      const r = await runGrader(spec, { workdir, runner: runnerResult, transcriptText, fixtureSrc });
      graderResults.push(r);
      appendEvent(runId, "grader_result", { case_id: def.id, sample, type: (spec as any).type, passed: r.passed, detail: r.detail.slice(0, 200) }, def.id);
    }
    const evaluation = evaluate(graderResults, def.pass_threshold ?? 1);
    rec.evaluation = evaluation;
    rec.grader_result = evaluation;
    if (rec.budget_exceeded) {
      rec.status = "failed";
      if (!rec.error_msg) rec.error_msg = "Budget exceeded";
    } else {
      rec.status = evaluation.passed ? "passed" : (runnerResult.isError ? "error" : "failed");
    }
    if (rec.status === "error" && !rec.error_msg) rec.error_msg = "Runner reported error";
  } catch (e: any) {
    rec.status = "error";
    rec.error_msg = `Grader threw: ${String(e?.stack || e)}`;
  }

  rec.ended_at = Date.now();
  updateRunCase(rcId, { status: rec.status, ended_at: rec.ended_at, grader_result: rec.grader_result, evaluation: rec.evaluation, budget_exceeded: rec.budget_exceeded, error_msg: rec.error_msg });
  appendEvent(runId, "case_finished", { case_id: def.id, seq, sample, status: rec.status }, def.id);
  return rec;
}
