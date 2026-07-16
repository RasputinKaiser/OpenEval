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

const harnessInfoCache = new Map<string, { id: string; bin: string | null; version: string | null }>();

async function loadHarnessInfo(harness: string | undefined, adapterId: string): Promise<{ id: string; bin: string | null; version: string | null } | undefined> {
  if (!harness) return undefined;
  const cached = harnessInfoCache.get(adapterId);
  if (cached) return cached;
  try {
    const discovered = await discoverHarnesses();
    const hit = discovered.find((h) => h.id === adapterId);
    const info = hit ? { id: adapterId, bin: hit.bin, version: hit.version } : { id: adapterId, bin: null, version: null };
    harnessInfoCache.set(adapterId, info);
    return info;
  } catch {
    const info = { id: adapterId, bin: null, version: null };
    harnessInfoCache.set(adapterId, info);
    return info;
  }
}

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
    const { execFileSync } = await import("node:child_process");
    // execFile (no shell) so a crafted case-descriptor repo value can't inject shell commands.
    execFileSync("git", ["clone", "--depth", "1", "--", setup.repo, "."], { cwd: dir, stdio: "pipe" });
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
    if (ent.isSymbolicLink()) {
      throw new Error(`Fixture symlinks are not supported: ${s}`);
    }
    if (ent.isDirectory()) {
      await fs.mkdir(d, { recursive: true });
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function resolveInputImages(def: CaseDefinition, workdir: string): Promise<string[]> {
  const requested = def.visual?.input_images ?? [];
  if (def.visual?.requires_vision_input && requested.length === 0) {
    throw new Error("This case requires vision input but declares no visual.input_images");
  }
  const images: string[] = [];
  const realWorkdir = await fs.realpath(workdir);
  for (const relative of requested) {
    if (path.isAbsolute(relative)) throw new Error(`Visual input must be relative to the case workdir: ${relative}`);
    const absolute = path.resolve(workdir, relative);
    const rel = path.relative(workdir, absolute);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Visual input escapes the case workdir: ${relative}`);
    }
    const realAbsolute = await fs.realpath(absolute).catch(() => null);
    if (!realAbsolute) throw new Error(`Visual input file is missing: ${relative}`);
    const realRel = path.relative(realWorkdir, realAbsolute);
    if (!realRel || realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw new Error(`Visual input escapes the case workdir: ${relative}`);
    }
    const stat = await fs.stat(realAbsolute).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Visual input file is missing: ${relative}`);
    images.push(realAbsolute);
  }
  return images;
}

function transcriptToText(r: RunnerResult): string {
  const lines: string[] = [];
  for (const m of r.transcript) {
    if (m.role === "assistant") {
      for (const b of m.content) {
        if (b.type === "text") lines.push(`ASSISTANT: ${b.text}`);
        else if (b.type === "tool_use") lines.push(`TOOL_USE(${b.name}): ${JSON.stringify(b.input).slice(0, 1000)}`);
      }
    } else if (m.role === "user") {
      for (const b of m.content) {
        if (b.type === "tool_result") lines.push(`TOOL_RESULT(${b.tool_use_id}): ${b.content.slice(0, 2000)}`);
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
  let workdir: string;
  let fixtureSrc: string | undefined;
  try {
    ({ dir: workdir, fixtureSrc } = await prepareWorkdir(runId, def.id, def, sample));
  } catch (e: any) {
    // Workdir prep (fixture copy / git clone) failed. Record this case as
    // errored so it still counts in the summary and one bad case cannot abort
    // the whole run by throwing out of the worker pool.
    const now = Date.now();
    const errRec: RunCaseRecord & { seq: number } = {
      id: rcId, run_id: runId, case_id: def.id, case_name: def.name, category: def.category,
      difficulty: def.difficulty, status: "error", started_at: now, ended_at: now,
      workdir_path: path.join(WORKDIRS_DIR, runId, `${def.id}__s${sample}`), transcript_path: null, runner_kind: runnerKind, runner_result: null,
      grader_result: null, evaluation: null, budget_exceeded: false,
      error_msg: `Workdir preparation failed: ${String(e?.stack || e)}`,
      case_def: def, seq, sample,
    };
    insertRunCase(errRec);
    appendEvent(runId, "case_finished", { case_id: def.id, seq, sample, status: "error" }, def.id);
    return errRec;
  }
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
  let images: string[];
  try {
    images = await resolveInputImages(def, workdir);
    if (images.length && !adapter.descriptor.imageFlag) {
      throw new Error(`Harness "${adapter.id}" does not declare a local image attachment flag`);
    }
    if (images.length && adapter.capabilities.supportsVisionInput === false) {
      throw new Error(`Harness "${adapter.id}" does not support vision input`);
    }
  } catch (e: any) {
    rec.status = "error";
    rec.error_msg = `Vision input preparation failed: ${String(e?.message || e)}`;
    rec.ended_at = Date.now();
    updateRunCase(rcId, { status: rec.status, ended_at: rec.ended_at, error_msg: rec.error_msg });
    appendEvent(runId, "case_finished", { case_id: def.id, seq, sample, status: rec.status }, def.id);
    return rec;
  }
  const harnessInfo = await loadHarnessInfo(harness, adapter.id);
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
    images,
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
    const infraGraderFailure = graderResults.some((g) => g.infraError && !g.passed);
    const agentGraderFailure = graderResults.some((g) => !g.passed && !g.infraError);
    if (runnerResult.isError) {
      // A runner that never completed cannot pass vacuously through negated or
      // absence-based graders. Preserve partial grader evidence, but status is
      // an infrastructure error regardless of the computed pass ratio.
      rec.status = "error";
    } else if (rec.budget_exceeded) {
      rec.status = "failed";
      if (!rec.error_msg) rec.error_msg = "Budget exceeded";
    } else if (agentGraderFailure) {
      // Real evidence that the agent failed must not be masked by a concurrent
      // unavailable LLM judge.
      rec.status = "failed";
    } else if (infraGraderFailure) {
      // A grader's INFRASTRUCTURE failed (LLM judge unavailable). That says
      // nothing about the agent — record an error, not a failure, so pass
      // thresholds cannot silently absorb a missing judge CLI into a pass.
      rec.status = "error";
      const why = graderResults.find((g) => g.infraError && !g.passed)?.detail ?? "grader infrastructure failed";
      rec.error_msg = (rec.error_msg ? rec.error_msg + " | " : "") + why.slice(0, 300);
    } else {
      rec.status = evaluation.passed ? "passed" : "failed";
    }
    if (rec.status === "error" && !rec.error_msg) {
      rec.error_msg = runnerResult.isError && runnerResult.resultText
        ? `Runner error: ${runnerResult.resultText.slice(0, 500)}`
        : "Runner reported error";
    }
  } catch (e: any) {
    rec.status = "error";
    rec.error_msg = `Grader threw: ${String(e?.stack || e)}`;
  }

  rec.ended_at = Date.now();
  updateRunCase(rcId, { status: rec.status, ended_at: rec.ended_at, grader_result: rec.grader_result, evaluation: rec.evaluation, budget_exceeded: rec.budget_exceeded, error_msg: rec.error_msg });
  appendEvent(runId, "case_finished", { case_id: def.id, seq, sample, status: rec.status }, def.id);
  return rec;
}
