import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { evidenceLabel, graderEvidenceTier } from "../accuracy";
import { runJudge } from "./judge";
import type { CaseEvaluation, GraderResult, GraderSpec, RunnerResult } from "../types";

function runShell(spec: { command: string; cwd?: string; env?: Record<string, string>; timeout_ms?: number }): Promise<{ code: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const env = { ...process.env, ...(spec.env || {}) };
    const p = spawn("bash", ["-lc", spec.command], { cwd: spec.cwd, env });
    let out = "";
    let err = "";
    let settled = false;
    let timedOut = false;
    const finish = (code: number, timedOutFlag = timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err, durationMs: Date.now() - start, timedOut: timedOutFlag });
    };
    p.stdout.on("data", (c) => (out += c.toString()));
    p.stderr.on("data", (c) => (err += c.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill("SIGKILL"); } catch {}
      setTimeout(() => finish(124, true), 1000);
    }, spec.timeout_ms ?? 30_000);
    p.on("error", () => finish(1, timedOut));
    p.on("close", (code) => {
      finish(timedOut ? 124 : code ?? 1, timedOut);
    });
  });
}

function ok(spec: GraderSpec, detail: string, durationMs: number, output?: string): GraderResult {
  const evidenceTier = graderEvidenceTier(spec);
  return { spec, passed: true, detail, durationMs, score: 1, evidenceTier, evidenceLabel: evidenceLabel(evidenceTier), output };
}

function fail(spec: GraderSpec, detail: string, durationMs: number, output?: string): GraderResult {
  const evidenceTier = graderEvidenceTier(spec);
  return { spec, passed: false, detail, durationMs, score: 0, evidenceTier, evidenceLabel: evidenceLabel(evidenceTier), output };
}

async function safeRead(p: string): Promise<string | null> {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

export async function runGrader(
  spec: GraderSpec,
  ctx: { workdir: string; runner: RunnerResult; transcriptText: string; fixtureSrc?: string }
): Promise<GraderResult> {
  const start = Date.now();
  const dur = () => Date.now() - start;

  if (spec.type === "exit_code" || spec.type === "tests_pass") {
    const res = await runShell({ command: spec.command, cwd: spec.cwd ? path.resolve(ctx.workdir, spec.cwd) : ctx.workdir, env: spec.env, timeout_ms: spec.timeout_ms });
    if (res.timedOut) {
      return fail(spec, `timeout after ${res.durationMs}ms`, dur(), `${res.stdout}\n${res.stderr}`.slice(0, 2000));
    }
    if (spec.type === "exit_code") {
      return res.code === 0
        ? ok(spec, `exit=0 in ${res.durationMs}ms`, dur(), res.stdout)
        : fail(spec, `exit=${res.code} in ${res.durationMs}ms\nstderr:\n${res.stderr.slice(0, 1000)}`, dur(), res.stdout);
    }
    // tests_pass: parse passed/failed counts from output
    const out = res.stdout + "\n" + res.stderr;
    const passedMatch = out.match(/(\d+)\s+(?:pass(?:ing|ed)?|passing tests?)/i);
    const failedMatch = out.match(/(\d+)\s+(?:fail(?:ing|ed)?)/i);
    const passN = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failN = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const detail = `exit=${res.code} passed=${passN} failed=${failN} in ${res.durationMs}ms`;
    const passed = res.code === 0 && failN === 0;
    return passed ? ok(spec, detail, dur(), out) : fail(spec, detail, dur(), out);
  }

  if (spec.type === "file_contains") {
    const filePath = path.resolve(ctx.workdir, spec.path);
    const content = await safeRead(filePath);
    if (content === null) return fail(spec, `file not found: ${spec.path}`, dur());
    try {
      const re = new RegExp(spec.pattern, "m");
      const matches = re.test(content);
      const passed = spec.negate ? !matches : matches;
      return passed
        ? ok(spec, `pattern ${spec.negate ? "absent" : "matched"} in ${spec.path}`, dur(), content.slice(0, 500))
        : fail(spec, `pattern ${spec.negate ? "matched (should be absent)" : "not found"} in ${spec.path}`, dur(), content.slice(0, 500));
    } catch (e) {
      return fail(spec, `invalid regex: ${spec.pattern} — ${String(e)}`, dur());
    }
  }

  if (spec.type === "file_exists") {
    const filePath = path.resolve(ctx.workdir, spec.path);
    let exists = false;
    try { await fs.access(filePath); exists = true; } catch { exists = false; }
    const passed = spec.negate ? !exists : exists;
    return passed ? ok(spec, `${spec.path} ${spec.negate ? "does not exist" : "exists"}`, dur()) : fail(spec, `${spec.path} ${spec.negate ? "exists (should not)" : "missing"}`, dur());
  }

  if (spec.type === "file_eq") {
    const filePath = path.resolve(ctx.workdir, spec.path);
    const content = await safeRead(filePath);
    if (content === null) return fail(spec, `file not found: ${spec.path}`, dur());
    const actual = spec.trim ? content.trim() : content;
    const expected = spec.trim ? spec.expected.trim() : spec.expected;
    return actual === expected
      ? ok(spec, `${spec.path} matches expected content`, dur(), actual)
      : fail(spec, `${spec.path} does not match expected`, dur(), `--- actual ---\n${actual.slice(0, 600)}\n--- expected ---\n${expected.slice(0, 600)}`);
  }

  if (spec.type === "regex_match") {
    const source = spec.source ?? "final_text";
    const text = source === "stdout"
      ? (ctx.runner.resultText + ctx.runner.finalText)
      : source === "transcript"
        ? ctx.transcriptText
        : ctx.runner.finalText || ctx.runner.resultText;
    try {
      const re = new RegExp(spec.pattern, "m");
      const matches = re.test(text);
      const passed = spec.negate ? !matches : matches;
      return passed
        ? ok(spec, `pattern ${spec.negate ? "absent" : "matched"} in ${source}`, dur(), text.slice(0, 500))
        : fail(spec, `pattern ${spec.negate ? "matched (should be absent)" : "not found"} in ${source}`, dur(), text.slice(0, 500));
    } catch (e) {
      return fail(spec, `invalid regex: ${spec.pattern} — ${String(e)}`, dur());
    }
  }

  if (spec.type === "json_path") {
    const filePath = path.resolve(ctx.workdir, spec.path);
    const content = await safeRead(filePath);
    if (content === null) return fail(spec, `file not found: ${spec.path}`, dur());
    let parsed: any;
    try { parsed = JSON.parse(content); } catch (e) { return fail(spec, `invalid JSON: ${String(e)}`, dur(), content.slice(0, 400)); }
    const segs = spec.jsonpath.split(".").filter(Boolean);
    let cur: any = parsed;
    for (const s of segs) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[s];
    }
    const actual = JSON.stringify(cur);
    const expected = JSON.stringify(spec.equals);
    return actual === expected
      ? ok(spec, `${spec.jsonpath} === ${expected}`, dur(), content.slice(0, 400))
      : fail(spec, `${spec.jsonpath} !== ${expected} (got ${actual})`, dur(), content.slice(0, 400));
  }

  if (spec.type === "files_unchanged") {
    const changes: string[] = [];
    for (const rel of spec.paths) {
      const actualPath = path.resolve(ctx.workdir, rel);
      let baselinePath: string | null = null;
      if (spec.fixture && ctx.fixtureSrc) baselinePath = path.resolve(ctx.fixtureSrc, rel);
      else if (ctx.fixtureSrc) baselinePath = path.resolve(ctx.fixtureSrc, rel);
      const actual = await safeRead(actualPath);
      const baseline = baselinePath ? await safeRead(baselinePath) : null;
      if (actual === null && baseline === null) { changes.push(`${rel}: absent in both`); continue; }
      if (actual === null || baseline === null) { changes.push(`${rel}: existence changed (${baseline ? "existed → deleted" : "created"})`); continue; }
      const ah = createHash("sha256").update(actual).digest("hex");
      const bh = createHash("sha256").update(baseline).digest("hex");
      if (ah !== bh) changes.push(`${rel}: content modified (sha256 ${bh.slice(0, 8)} → ${ah.slice(0, 8)})`);
    }
    return changes.length === 0
      ? ok(spec, `${spec.paths.length} file(s) unchanged`, dur())
      : fail(spec, `${changes.length} file(s) modified:\n${changes.join("\n")}`, dur());
  }

  if (spec.type === "file_deleted") {
    const exists = await safeRead(path.resolve(ctx.workdir, spec.path));
    return exists === null
      ? ok(spec, `${spec.path} deleted`, dur())
      : fail(spec, `${spec.path} still exists (should be deleted)`, dur(), exists.slice(0, 200));
  }

  if (spec.type === "git_diff_contains") {
    const res = await runShell({ command: `git diff --no-color ${spec.pathFilter ? `-- ${spec.pathFilter}` : ""}`, cwd: ctx.workdir, timeout_ms: 10_000 });
    const diff = res.stdout;
    try {
      const re = new RegExp(spec.pattern, "m");
      const matches = re.test(diff);
      const passed = spec.negate ? !matches : matches;
      return passed
        ? ok(spec, `pattern ${spec.negate ? "absent in diff" : "found in diff"}`, dur(), diff.slice(0, 500))
        : fail(spec, `pattern ${spec.negate ? "present in diff (should be absent)" : "not in diff"}`, dur(), diff.slice(0, 500));
    } catch (e) {
      return fail(spec, `invalid regex: ${spec.pattern} — ${String(e)}`, dur());
    }
  }

  if (spec.type === "checksum") {
    const algo = spec.algorithm ?? "sha256";
    const content = await safeRead(path.resolve(ctx.workdir, spec.path));
    if (content === null) return fail(spec, `file not found: ${spec.path}`, dur());
    const hash = createHash(algo).update(content).digest("hex");
    return hash === spec.expected
      ? ok(spec, `${algo}(${spec.path}) = ${hash.slice(0, 12)}…`, dur())
      : fail(spec, `${algo} mismatch: got ${hash}, expected ${spec.expected}`, dur());
  }

  if (spec.type === "step") {
    const calls = ctx.runner.toolCalls;
    const matches = (c: any) => {
      if (spec.tool && c.name !== spec.tool) return false;
      const inv = typeof c.input === "string" ? c.input : JSON.stringify(c.input ?? "");
      if (spec.input_includes && !inv.includes(spec.input_includes)) return false;
      if (spec.input_includes_any && !spec.input_includes_any.some((s: string) => inv.includes(s))) return false;
      return true;
    };
    const matched = calls.filter(matches);
    if (spec.negate) {
      return matched.length === 0
        ? ok(spec, `no matching step found (${calls.length} calls)`, dur(), matched.map((m) => m.name).join(","))
        : fail(spec, `${matched.length} unwanted step(s): ${matched.slice(0, 5).map((m) => m.name).join(", ")}`, dur());
    }
    if (typeof spec.at_index === "number") {
      const c = calls[spec.at_index];
      return c && matches(c)
        ? ok(spec, `step[${spec.at_index}] = ${c.name}`, dur())
        : fail(spec, `step[${spec.at_index}] did not match (got ${c?.name ?? "nothing"})`, dur());
    }
    if (spec.before_tool) {
      const firstMatchIdx = matched[0] ? calls.indexOf(matched[0]) : -1;
      const beforeIdx = calls.findIndex((c) => c.name === spec.before_tool);
      if (firstMatchIdx >= 0 && (beforeIdx < 0 || firstMatchIdx < beforeIdx)) {
        return ok(spec, `${calls[firstMatchIdx].name} before ${spec.before_tool}`, dur());
      }
      return fail(spec, `expected ${spec.tool ?? "matching"} call before first ${spec.before_tool}`, dur());
    }
    const min = spec.min_count ?? 1;
    return matched.length >= min
      ? ok(spec, `${matched.length} matching step(s) ≥ ${min}`, dur(), matched.map((m) => m.name).join(","))
      : fail(spec, `only ${matched.length} matching step(s), needed ≥ ${min}`, dur());
  }

  if (spec.type === "rubric_llm") {
    const judgeHarness = spec.judge_harness || process.env.JUDGE_HARNESS || "claude-code";
    const judgeModel = spec.judge_model || process.env.JUDGE_MODEL || spec.model || undefined;
    const prompt = `You are grading an agent task. Rubric:\n${spec.rubric}\n\nAgent final output:\n"${(ctx.runner.finalText || ctx.runner.resultText || "").slice(0, 4000)}"\n\nTranscript excerpt:\n${ctx.transcriptText.slice(0, 4000)}\n\nReply with only JSON: {"passed": <bool>, "score": <0..1>, "reason": "<short>"}`;
    const res = await runJudge({ harness: judgeHarness, model: judgeModel, prompt, timeoutMs: 120_000 });
    let judge: { passed?: boolean; score?: number; reason?: string } | null = null;
    if (res.ok || res.text) {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) { try { judge = JSON.parse(m[0]); } catch {} }
    }
    const passed = judge?.passed === true || (judge?.score ?? 0) >= (spec.min_score ?? 0.7);
    const score = typeof judge?.score === "number" ? judge.score : passed ? 1 : 0;
    const detailSuffix = `via ${judgeHarness}${judgeModel ? "/" + judgeModel : ""}`;
    return passed
      ? ok(spec, `LLM judge ${detailSuffix}: ${judge?.reason ?? "passed"} (score=${score})`, dur(), res.text.slice(0, 500))
      : fail(spec, `LLM judge ${detailSuffix}: ${judge?.reason ?? res.error ?? "failed"} (score=${score})`, dur(), res.text.slice(0, 500));
  }

  if (spec.type === "manual") {
    return { spec, passed: false, detail: `Pending manual review: ${spec.note ?? ""}`, durationMs: dur(), score: 0 };
  }

  return fail(spec, `unknown grader type`, dur());
}

export function evaluate(results: GraderResult[], passThreshold = 1): CaseEvaluation {
  const weights = results.map((r) => (r.spec as any).weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const passedWeight = results.reduce((sum, r, i) => (r.passed ? sum + weights[i] : sum), 0);
  const passRatio = passedWeight / totalWeight;
  const forbiddenViolations = results.filter((r) => (r.spec as any).forbidden && !r.passed);
  const passed = forbiddenViolations.length === 0 && passRatio >= passThreshold;
  return {
    passed,
    passRatio,
    results,
    durationMs: results.reduce((a, b) => a + b.durationMs, 0),
  };
}
