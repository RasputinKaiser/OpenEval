import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FIXTURES_DIR, TRANSCRIPTS_DIR, WORKDIRS_DIR } from "./config";
import { appendEvent, insertRunCase, updateRunCase } from "./db";
import { runGrader, evaluate } from "./grader";
import { getRunner } from "./runner";
import type { CaseDefinition, RunCaseRecord, RunnerKind, RunnerResult } from "./types";

export async function prepareWorkdir(runId: string, caseId: string, def: CaseDefinition): Promise<string> {
  const dir = path.join(WORKDIRS_DIR, runId, caseId);
  await fs.mkdir(dir, { recursive: true });
  const setup = def.setup;
  if (!setup || setup.type === "none") return dir;
  if (setup.type === "fixture" && setup.fixture) {
    const src = path.resolve(FIXTURES_DIR, setup.fixture);
    await copyDir(src, dir);
  } else if (setup.type === "git-clone" && setup.repo) {
    const { execSync } = await import("node:child_process");
    execSync(`git clone --depth 1 ${setup.repo} .`, { cwd: dir, stdio: "pipe" });
  }
  return dir;
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
  modelOverride?: string
): Promise<RunCaseRecord> {
  const rcId = randomUUID();
  const workdir = await prepareWorkdir(runId, def.id, def);
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${runId}_${def.id}.jsonl`);

  const rec: RunCaseRecord & { seq: number } = {
    id: rcId,
    run_id: runId,
    case_id: def.id,
    case_name: def.name,
    category: def.category,
    status: "running",
    started_at: Date.now(),
    ended_at: null,
    workdir_path: workdir,
    transcript_path: transcriptPath,
    runner_kind: runnerKind,
    runner_result: null,
    grader_result: null,
    error_msg: null,
    case_def: def,
    seq,
  };
  insertRunCase(rec);
  appendEvent(runId, "case_started", { case_id: def.id, seq, name: def.name, category: def.category }, def.id);

  const runner = getRunner(runnerKind);
  const runnerCfg = def.runner || {};
  const ctx = {
    caseId: def.id,
    workdir,
    prompt: def.prompt,
    maxTurns: runnerCfg.max_turns ?? 25,
    timeoutMs: (runnerCfg.timeout_seconds ?? 300) * 1000,
    permissionMode: runnerCfg.permission_mode ?? "bypassPermissions",
    model: modelOverride || runnerCfg.model,
    extraArgs: runnerCfg.extra_args ?? [],
    onEvent: (ev: any) => {
      try { fs.appendFile(transcriptPath, JSON.stringify(ev) + "\n"); } catch {}
      if (ev.kind === "tool_use") appendEvent(runId, "tool_use", { case_id: def.id, tool: ev.tool, id: ev.id }, def.id);
      else if (ev.kind === "tool_result") appendEvent(runId, "tool_result", { case_id: def.id, id: ev.id, error: ev.isError }, def.id);
      else if (ev.kind === "message") appendEvent(runId, "assistant_message", { case_id: def.id, text: (ev.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").slice(0, 200)) }, def.id);
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

  rec.runner_result = runnerResult;
  rec.status = "grading";
  updateRunCase(rcId, { status: "grading", runner_result: runnerResult, error_msg: rec.error_msg });
  appendEvent(runId, "case_grading", { case_id: def.id, duration_ms: runnerResult.durationMs }, def.id);

  try {
    const transcriptText = transcriptToText(runnerResult);
    const graderResults = [];
    for (const spec of def.graders) {
      const r = await runGrader(spec, { workdir, runner: runnerResult, transcriptText });
      graderResults.push(r);
      appendEvent(runId, "grader_result", { case_id: def.id, type: (spec as any).type, passed: r.passed, detail: r.detail.slice(0, 200) }, def.id);
    }
    const evaluation = evaluate(graderResults, def.pass_threshold ?? 1);
    rec.grader_result = evaluation;
    rec.status = evaluation.passed ? "passed" : (runnerResult.isError ? "error" : "failed");
    if (rec.status === "error" && !rec.error_msg) rec.error_msg = "Runner reported error";
  } catch (e: any) {
    rec.status = "error";
    rec.error_msg = `Grader threw: ${String(e?.stack || e)}`;
  }

  rec.ended_at = Date.now();
  updateRunCase(rcId, { status: rec.status, ended_at: rec.ended_at, grader_result: rec.grader_result, error_msg: rec.error_msg });
  appendEvent(runId, "case_finished", { case_id: def.id, seq, status: rec.status }, def.id);
  return rec;
}