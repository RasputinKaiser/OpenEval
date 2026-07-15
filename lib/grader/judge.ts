import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../adapters/registry";
import type { RunnerContext } from "../types";
import { spawnHarnessProcess, emptyRunnerResult } from "../runner/spawn";

export interface JudgeResult {
  ok: boolean;
  text: string;
  durationMs: number;
  raw: string;
  error?: string;
}

export const OPENROUTER_DEFAULT_JUDGE_MODEL = "tencent/hy3:free";
export const CODEX_DEFAULT_JUDGE_MODEL = "gpt-5.5";

export function defaultJudgeModel(harness: string): string | undefined {
  if (harness === "openrouter") return OPENROUTER_DEFAULT_JUDGE_MODEL;
  if (harness === "codex") return CODEX_DEFAULT_JUDGE_MODEL;
  return undefined;
}

/**
 * Extract a JSON object from a judge's reply, tolerating prose, code fences, or
 * chain-of-thought around it. Tries the widest `{…}` span first, then narrows
 * the start forward until one parses — far more robust than a single greedy
 * match, which fails whenever the model adds any text around the JSON.
 */
export function extractJudgeJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const direct = text.trim();
  try {
    const v = JSON.parse(direct);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  for (let start = text.indexOf("{"); start !== -1 && start < end; start = text.indexOf("{", start + 1)) {
    try {
      const v = JSON.parse(text.slice(start, end + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {}
  }
  return null;
}

/**
 * A judge's score is only meaningful on the 0..1 scale the prompt demands.
 * Out-of-range replies (a model grading on 0..10, or echoing garbage) are
 * MALFORMED, not clampable — clamping an 8/10 to 1.0 silently corrupts the
 * verdict, so callers must treat null as "judge failed", never as a score.
 */
export function validJudgeScore(score: unknown): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score < 0 || score > 1) return null;
  return score;
}

/**
 * Judge backend order: JUDGE_HARNESS always wins; otherwise prefer OpenRouter
 * when a key is available (free tier — judging shouldn't burn CLI plan quota),
 * falling back to the Codex CLI. "openrouter" is an HTTP backend, not a
 * harness adapter; JUDGE_MODEL picks the model for either.
 */
export function resolveJudge(): { harness: string; model?: string; judgeName: string } {
  const harness = process.env.JUDGE_HARNESS || (process.env.OPENROUTER_API_KEY ? "openrouter" : "codex");
  // A concrete Codex default avoids inheriting a configured model an older CLI
  // cannot run. Per-harness defaults also apply to explicit grader overrides.
  const model = process.env.JUDGE_MODEL || defaultJudgeModel(harness);
  return { harness, model, judgeName: `${harness}${model ? "/" + model : ""}` };
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the assistant text out of an OpenRouter chat completion. */
export function openRouterContent(json: unknown): string | null {
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

/**
 * Judge via the OpenRouter HTTP API instead of a local harness CLI. Retries
 * 429s with backoff — free-tier models are aggressively rate-limited and a
 * long queue must degrade to slower, not to failed.
 */
export async function runOpenRouterJudge(prompt: string, model: string, timeoutMs: number): Promise<{ ok: boolean; text: string; error?: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, text: "", error: "OPENROUTER_API_KEY not set" };
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(5_000 * 2 ** (attempt - 1)); // 5s, 10s, 20s
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            // Reasoning models think in-band; leave room so the JSON verdict
            // at the end doesn't get truncated away.
            max_tokens: 2000,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) { lastError = "429 rate limited"; continue; }
      const json: unknown = await res.json();
      if (!res.ok) return { ok: false, text: "", error: JSON.stringify(json).slice(0, 300) };
      const text = openRouterContent(json);
      if (text) return { ok: true, text };
      lastError = "empty completion";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, text: "", error: lastError };
}

/**
 * A judge only ever needs to read its prompt and emit JSON — it must not
 * inherit tool access or the repo as cwd, because judge prompts embed
 * arbitrary text the evaluated agent (or a stranger's transcript) controls.
 * Each invocation gets a throwaway scratch dir and the harness's restricted
 * permission mode instead of bypassPermissions.
 */
export async function runJudge(opts: {
  harness: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
}): Promise<JudgeResult> {
  let scratch: string | null = null;
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judge-"));
  } catch {
    scratch = null;
  }
  const ctx: RunnerContext = {
    caseId: "llm-judge",
    workdir: scratch ?? os.tmpdir(),
    prompt: opts.prompt,
    maxTurns: 1,
    timeoutMs: opts.timeoutMs,
    permissionMode: "default",
    model: opts.model,
    extraArgs: [],
    harness: opts.harness,
  };
  try {
    const { acc, stdout, stderr, exitCode, durationMs, timedOut } = await spawnHarnessProcess(ctx, (line, accumulator) => {
      const adapter = getAdapter(opts.harness);
      try { adapter.parseLine(line, accumulator); } catch {}
    });
    const r = acc.result || emptyRunnerResult();
    const text = r.finalText || r.resultText || acc.finalText || stdout;
    // A timed-out (SIGKILLed) or nonzero-exit judge is a FAILED judge even if it
    // streamed partial text: partial output can contain a truncated or echoed
    // JSON object that parses but is not a verdict.
    const ok = !timedOut && (exitCode === 0 || exitCode === null) && !r.isError && !!text;
    return {
      ok,
      text,
      durationMs,
      raw: stdout,
      error: timedOut
        ? `judge timed out after ${opts.timeoutMs}ms`
        : r.isError
          ? text
          : exitCode !== 0 && exitCode !== null
            ? `judge exited ${exitCode}: ${(stderr || stdout).trim().slice(0, 300)}`
            : stderr.trim() || undefined,
    };
  } finally {
    if (scratch) fs.rm(scratch, { recursive: true, force: true }, () => {});
  }
}

/**
 * Run a judge prompt on whichever backend `resolveJudge` (or an explicit
 * harness override) picks — the one entry point shared by the rubric_llm
 * grader and the session-outcome judge, so both follow the same backend
 * order and the same failure semantics.
 */
export async function runJudgeBackend(opts: {
  harness: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (opts.harness === "openrouter") {
    return runOpenRouterJudge(opts.prompt, opts.model ?? OPENROUTER_DEFAULT_JUDGE_MODEL, opts.timeoutMs);
  }
  const res = await runJudge(opts);
  return { ok: res.ok, text: res.text, error: res.error };
}
