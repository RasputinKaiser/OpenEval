import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { getAdapter } from "../adapters/registry";
import type { RunnerContext } from "../types";
import { spawnHarnessProcess, emptyRunnerResult } from "../runner/spawn";
import {
  CODEX_JUDGE_MODEL,
  CODEX_JUDGE_REASONING_EFFORT,
  defaultJudgeModelForSource,
  defaultJudgeReasoningForSource,
  DETERMINISTIC_JUDGE_SOURCE,
  resolveJudgeSelection,
  type JudgeSelection,
} from "./selection";

export type { JudgeSelection } from "./selection";

export interface JudgeResult {
  ok: boolean;
  text: string;
  durationMs: number;
  raw: string;
  error?: string;
}

/**
 * The rubric grader has a narrower response contract than the session judge.
 * Keep the generic JSON extractor below for the latter, but validate rubric
 * replies before they can influence a case result. Optional fields preserve
 * compatibility with the historical boolean-only and score-only replies; any
 * field that is present must still have the type and bounded size promised by
 * the rubric prompt.
 */
export const RubricJudgeVerdictSchema = z
  .object({
    passed: z.boolean().optional(),
    score: z.number().finite().min(0).max(1).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((verdict) => verdict.passed !== undefined || verdict.score !== undefined, {
    message: "verdict must include passed or score",
  });

export type RubricJudgeVerdict = z.infer<typeof RubricJudgeVerdictSchema>;

export interface RubricJudgeParseResult {
  verdict: RubricJudgeVerdict | null;
  error?: string;
}

export type RubricJudgeFailureCode = "backend_unavailable" | "cancelled" | "invalid_verdict";

export interface RubricJudgeFailureRecord {
  contract: "openeval.rubric-judge";
  version: 1;
  status: "blocked";
  backend: { harness: string; model: string | null };
  failure: { code: RubricJudgeFailureCode; detail: string };
  response?: string;
}

export const OPENROUTER_DEFAULT_JUDGE_MODEL = "tencent/hy3:free";
/** The Codex subscription-backed judge used by the current Evaluate workflow. */
export const CODEX_DEFAULT_JUDGE_MODEL = CODEX_JUDGE_MODEL;
export const CODEX_DEFAULT_JUDGE_REASONING_EFFORT = CODEX_JUDGE_REASONING_EFFORT;

export function defaultJudgeModel(harness: string): string | undefined {
  return defaultJudgeModelForSource(harness) || undefined;
}

export function defaultJudgeReasoningEffort(harness: string): string | undefined {
  return defaultJudgeReasoningForSource(harness) ?? undefined;
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

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Validate the exact rubric verdict after extracting JSON from a reply. */
export function parseRubricJudgeVerdict(text: string): RubricJudgeParseResult {
  const json = extractJudgeJson(text);
  if (!json) return { verdict: null, error: "no JSON object found in judge reply" };
  const parsed = RubricJudgeVerdictSchema.safeParse(json);
  return parsed.success
    ? { verdict: parsed.data }
    : { verdict: null, error: `invalid rubric verdict: ${formatSchemaIssues(parsed.error)}` };
}

/**
 * Keep judge failures inspectable after the case is persisted. This is a
 * diagnostic receipt, not a verdict: blocked judge infrastructure must never
 * become an agent pass/fail claim.
 */
export function serializeRubricJudgeFailure(input: {
  harness: string;
  model?: string;
  reasoningEffort?: string | null;
  code: RubricJudgeFailureCode;
  detail: string;
  response?: string;
}): string {
  const record: RubricJudgeFailureRecord = {
    contract: "openeval.rubric-judge",
    version: 1,
    status: "blocked",
    backend: { harness: input.harness, model: input.model ?? null },
    failure: { code: input.code, detail: input.detail.slice(0, 500) },
    ...(input.response ? { response: input.response.slice(0, 500) } : {}),
  };
  return JSON.stringify(record, null, 2);
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
 * Judge backend order: explicit environment variables win, then the local
 * Settings-page selection, then the pinned Codex subscription fallback.
 * "openrouter" is an HTTP backend, not a harness adapter, and must be selected
 * explicitly; a merely-present API key does not move local judging elsewhere.
 */
export function resolveJudge(): { harness: string; model?: string; reasoningEffort?: string; judgeName: string; selection: JudgeSelection } {
  const selection = resolveJudgeSelection();
  return { harness: selection.source, model: selection.model || undefined, reasoningEffort: selection.reasoningEffort ?? undefined, judgeName: selection.judgeName, selection };
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
export async function runOpenRouterJudge(prompt: string, model: string, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; text: string; error?: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, text: "", error: "OPENROUTER_API_KEY not set" };
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    // A cancelled run must stop the judge promptly, not queue another backoff.
    if (signal?.aborted) return { ok: false, text: "", error: "judge cancelled" };
    if (attempt > 0) await sleep(5_000 * 2 ** (attempt - 1)); // 5s, 10s, 20s
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onCancel = () => ctrl.abort();
      if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener("abort", onCancel, { once: true });
      }
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
        if (signal) signal.removeEventListener("abort", onCancel);
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
  reasoningEffort?: string | null;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
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
    // Codex exposes reasoning effort as a config override rather than a
    // dedicated exec flag. Keep the judge setting explicit and reproducible.
    extraArgs: opts.harness === "codex"
      ? ["-c", `model_reasoning_effort=${JSON.stringify(opts.reasoningEffort || CODEX_DEFAULT_JUDGE_REASONING_EFFORT)}`]
      : [],
    harness: opts.harness,
    signal: opts.signal,
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
  reasoningEffort?: string | null;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (opts.harness === DETERMINISTIC_JUDGE_SOURCE) {
    // Deterministic transport is intentionally boring: it exercises the exact
    // receipt/parser path without spending provider tokens or creating a CLI
    // trace. Keep the response shape valid for both session and rubric judges.
    const score = deterministicScore(opts.prompt);
    return { ok: true, text: JSON.stringify({ passed: score >= 0.7, score, reason: "deterministic judge stub" }) };
  }
  if (opts.harness === "openrouter") {
    return runOpenRouterJudge(opts.prompt, opts.model ?? OPENROUTER_DEFAULT_JUDGE_MODEL, opts.timeoutMs, opts.signal);
  }
  const res = await runJudge(opts);
  return { ok: res.ok, text: res.text, error: res.error };
}

function deterministicScore(prompt: string): number {
  let hash = 2166136261;
  for (let i = 0; i < prompt.length; i++) hash = Math.imul(hash ^ prompt.charCodeAt(i), 16777619);
  return 0.5 + ((hash >>> 0) % 5) / 10;
}
