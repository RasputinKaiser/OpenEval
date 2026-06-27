import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { CaseEvaluation, GraderResult, GraderSpec, RunnerResult } from "../types";

function runShell(spec: { command: string; cwd?: string; env?: Record<string, string>; timeout_ms?: number }): Promise<{ code: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const env = { ...process.env, ...(spec.env || {}) };
    const p = spawn("bash", ["-lc", spec.command], { cwd: spec.cwd, env });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.stderr.on("data", (c) => (err += c.toString()));
    const timer = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
    }, spec.timeout_ms ?? 30_000);
    p.on("error", () => resolve({ code: 1, stdout: out, stderr: err, durationMs: Date.now() - start, timedOut: false }));
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: out, stderr: err, durationMs: Date.now() - start, timedOut: false });
    });
    p.on("exit", (code, signal) => {
      if (signal === "SIGKILL") {
        // already resolved if timeout fired; otherwise resolve now
      }
    });
  });
}

function ok(spec: GraderSpec, detail: string, durationMs: number, output?: string): GraderResult {
  return { spec, passed: true, detail, durationMs, score: 1, output };
}

function fail(spec: GraderSpec, detail: string, durationMs: number, output?: string): GraderResult {
  return { spec, passed: false, detail, durationMs, score: 0, output };
}

async function safeRead(p: string): Promise<string | null> {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

export async function runGrader(
  spec: GraderSpec,
  ctx: { workdir: string; runner: RunnerResult; transcriptText: string }
): Promise<GraderResult> {
  const start = Date.now();
  const dur = () => Date.now() - start;

  if (spec.type === "exit_code" || spec.type === "tests_pass") {
    const res = await runShell({ command: spec.command, cwd: spec.cwd ? path.resolve(ctx.workdir, spec.cwd) : ctx.workdir, env: spec.env, timeout_ms: spec.timeout_ms });
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

  if (spec.type === "rubric_llm") {
    // LLM judge: spawn ncode -p with the rubric + final output and ask for a 0-1 score
    const prompt = `You are grading an agent task. Rubric:\n${spec.rubric}\n\nAgent final output:\n"${(ctx.runner.finalText || ctx.runner.resultText || "").slice(0, 4000)}"\n\nTranscript excerpt:\n${ctx.transcriptText.slice(0, 4000)}\n\nReply with only JSON: {"passed": <bool>, "score": <0..1>, "reason": "<short>"}`;
    const res = await runShell({ command: `${process.env.NCODE_BIN || "ncode"} -p --output-format json --permission-mode bypassPermissions ${JSON.stringify(prompt)}`, timeout_ms: 120_000 });
    let judge: { passed?: boolean; score?: number; reason?: string } | null = null;
    try {
      // find result text
      const arr = JSON.parse(res.stdout);
      const r = Array.isArray(arr) ? arr.find((x: any) => x.type === "result") : null;
      const txt = r?.result || "";
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) judge = JSON.parse(m[0]);
    } catch {}
    const passed = judge?.passed === true || (judge?.score ?? 0) >= (spec.min_score ?? 0.7);
    const score = typeof judge?.score === "number" ? judge.score : passed ? 1 : 0;
    return passed
      ? ok(spec, `LLM judge: ${judge?.reason ?? "passed"} (score=${score})`, dur(), res.stdout.slice(0, 500))
      : fail(spec, `LLM judge: ${judge?.reason ?? "failed"} (score=${score})`, dur(), res.stdout.slice(0, 500));
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
  return {
    passed: passRatio >= passThreshold,
    passRatio,
    results,
    durationMs: results.reduce((a, b) => a + b.durationMs, 0),
  };
}