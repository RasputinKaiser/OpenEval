#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { loadCases } from "../cases";
import { prepareWorkdir } from "../executor";
import { runGrader, evaluate } from "../grader";
import type { RunnerResult } from "../types";

function runShell(cmd: string, cwd: string, timeoutMs = 30_000) {
  try {
    execSync(cmd, { cwd, stdio: "pipe", timeout: timeoutMs });
    return { code: 0, stdout: "", stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

function emptyRunnerResult(): RunnerResult {
  return {
    exitCode: 0, durationMs: 0, startedAt: Date.now(), endedAt: Date.now(),
    transcript: [], toolCalls: [], finalText: "", resultText: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0, stopReason: null, sessionId: null, model: null, isError: false, rawJson: null,
    tokenSegments: [], toolCallCounts: {},
  };
}

async function main() {
  const withLlmJudge = process.argv.includes("--with-llm-judge");
  const json = process.argv.includes("--json");
  const cases = await loadCases();
  if (cases.length === 0) { console.error("No cases found."); process.exit(1); }

  const tmpRun = `selftest-${Date.now().toString(36)}`;
  let pass = 0, fail = 0, skip = 0, llmSkip = 0;
  const failures: string[] = [];

  function log(msg: string) { if (!json) console.log(msg); }

  log(`Self-test: ${cases.length} cases${withLlmJudge ? " (with LLM judge)" : ""}\n`);
  for (const def of cases) {
    const noop = await prepareWorkdir(tmpRun, `${def.id}-noop`, def, 0);
    const noopRunner = emptyRunnerResult();
    const noopResults = [];
    for (const spec of def.graders) {
      if (spec.type === "rubric_llm" && !withLlmJudge) { llmSkip++; continue; }
      const r = await runGrader(spec, { workdir: noop.dir, runner: noopRunner, transcriptText: "", fixtureSrc: noop.fixtureSrc });
      noopResults.push(r);
    }
    const noopEval = evaluate(noopResults, def.pass_threshold ?? 1);
    const noopMax = def.oracle?.noop_max_score ?? 0;
    if (noopEval.passed || noopEval.passRatio > noopMax) {
      fail++;
      failures.push(`${def.id}: no-op baseline scored ${noopEval.passRatio.toFixed(2)} (max ${noopMax})`);
      console.log(`  FAIL  ${def.id.padEnd(36)} no-op baseline was accepted`);
      continue;
    }

    if (!def.oracle?.solve && !def.oracle?.final_text) {
      skip++;
      console.log(`  SKIP  ${def.id.padEnd(36)} noop:reject  (no oracle)`);
      continue;
    }
    const { dir, fixtureSrc } = await prepareWorkdir(tmpRun, def.id, def, 0);
    const scriptPath = def.oracle.solve ? path.resolve("cases", def.category, def.oracle.solve) : null;
    let oracleOk = true;
    let oracleErr = "";
    if (scriptPath) try {
      execSync(`bash ${JSON.stringify(scriptPath)}`, { cwd: dir, stdio: "pipe", timeout: 30_000 });
    } catch (e: any) {
      oracleOk = false;
      oracleErr = (e.stderr?.toString() || e.message || "").slice(0, 300);
    }
    if (!oracleOk) {
      fail++;
      failures.push(`${def.id}: oracle script failed — ${oracleErr}`);
      console.log(`  FAIL  ${def.id.padEnd(36)} oracle script failed`);
      continue;
    }
    const runner = emptyRunnerResult();
    if (def.oracle.final_text) {
      runner.finalText = def.oracle.final_text;
      runner.resultText = def.oracle.final_text;
    }
    const transcriptText = "";
    const results = [];
    for (const spec of def.graders) {
      if (spec.type === "rubric_llm" && !withLlmJudge) { llmSkip++; continue; }
      const r = await runGrader(spec, { workdir: dir, runner, transcriptText, fixtureSrc });
      results.push(r);
    }
    const eval_ = evaluate(results, def.pass_threshold ?? 1);
    const detail = results.map((r) => `${r.spec.type}:${r.passed ? "ok" : "FAIL"}`).join("  ");
    if (eval_.passed) {
      pass++;
      console.log(`  PASS  ${def.id.padEnd(36)} ${detail}`);
    } else {
      fail++;
      failures.push(`${def.id}: ${(results.filter((r) => !r.passed).map((r) => r.detail)).join("; ")}`);
      console.log(`  FAIL  ${def.id.padEnd(36)} ${detail}`);
    }
  }

  log(`\nSelf-test result: ${pass} pass, ${fail} fail, ${skip} skip (no oracle)${llmSkip > 0 ? `, ${llmSkip} skip (LLM judge — use --with-llm-judge to enable)` : ""}`);
  if (failures.length) {
    log("\nFailures:");
    for (const f of failures) log(`  - ${f}`);
  }
  if (json) {
    console.log(JSON.stringify({ ok: fail === 0, pass, fail, skip, llmSkip, total: cases.length, failures }));
  }
  // cleanup
  try { fs.rmSync(path.join(os.tmpdir(), "..", "data", "workdirs", tmpRun), { recursive: true, force: true }); } catch {}
  try {
    const wd = path.resolve("data", "workdirs", tmpRun);
    fs.rmSync(wd, { recursive: true, force: true });
  } catch {}
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ok: false, error: String(e).slice(0, 500) }));
  } else {
    console.error(e);
  }
  process.exit(1);
});
