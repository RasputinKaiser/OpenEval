import { getAdapter, hasAdapter } from "../adapters/registry";
import { probeHarness } from "../adapters/discover";
import { readAppSettings } from "../settings";

export type JudgeResolution = "case" | "job" | "environment" | "settings" | "fallback";
export type JudgeReadiness = "ready" | "unavailable" | "forbidden" | "unknown";

/** The immutable, source-scoped identity of a judge invocation. */
export interface JudgeSelection {
  source: string;
  model: string;
  reasoningEffort: string | null;
  resolution: JudgeResolution;
  readiness: JudgeReadiness;
  readinessDetail?: string;
  judgeName: string;
}

export interface JudgeSelectionInput {
  source?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}

export interface JudgeCasePin extends JudgeSelectionInput {
  judge_harness?: string | null;
  judge_model?: string | null;
}

export const DETERMINISTIC_JUDGE_SOURCE = "stub";
export const DETERMINISTIC_JUDGE_MODEL = "deterministic-v1";
export const OPENROUTER_JUDGE_MODEL = "tencent/hy3:free";
export const CODEX_JUDGE_MODEL = "gpt-5.6-luna";
export const CODEX_JUDGE_REASONING_EFFORT = "high";

/** Normalize user-facing aliases before validating or persisting a source. */
export function normalizeJudgeSource(value: unknown): string | undefined {
  const source = clean(value);
  return source === "claude" ? "claude-code" : source;
}

export function defaultJudgeModelForSource(source: string): string {
  if (source === "openrouter") return OPENROUTER_JUDGE_MODEL;
  if (source === "codex") return CODEX_JUDGE_MODEL;
  if (source === DETERMINISTIC_JUDGE_SOURCE) return DETERMINISTIC_JUDGE_MODEL;
  if (source === "claude-code") return "sonnet";
  try { return getAdapter(source).descriptor.models?.default ?? ""; } catch { return ""; }
}

export function defaultJudgeReasoningForSource(source: string): string | null {
  return source === "codex" ? CODEX_JUDGE_REASONING_EFFORT : null;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceOf(input?: JudgeSelectionInput | null): string | undefined {
  return normalizeJudgeSource(input?.source);
}

function modelOf(input?: JudgeSelectionInput | null): string | undefined {
  return clean(input?.model);
}

function effortOf(input?: JudgeSelectionInput | null): string | undefined {
  return clean(input?.reasoningEffort);
}

function nameFor(source: string, model: string, reasoningEffort: string | null): string {
  return `${source}${model ? `/${model}` : ""}${reasoningEffort ? ` (${reasoningEffort})` : ""}`;
}

function freezeSelection(selection: JudgeSelection): JudgeSelection {
  return Object.freeze(selection);
}

/**
 * Resolve a single atomic choice. A model is always filled from the selected
 * source; an explicit model never borrows the model belonging to another
 * source. This is intentionally synchronous so it can be used in receipts.
 */
export function makeJudgeSelection(input: JudgeSelectionInput & { resolution: JudgeResolution }): JudgeSelection {
  const source = sourceOf(input) ?? "codex";
  const model = modelOf(input) ?? defaultJudgeModelForSource(source);
  const reasoningEffort = effortOf(input) ?? defaultJudgeReasoningForSource(source);
  return freezeSelection({
    source,
    model,
    reasoningEffort: reasoningEffort ?? null,
    resolution: input.resolution,
    readiness: "unknown",
    judgeName: nameFor(source, model, reasoningEffort ?? null),
  });
}

function envInput(): JudgeSelectionInput {
  return {
    source: process.env.JUDGE_HARNESS,
    model: process.env.JUDGE_MODEL,
    reasoningEffort: process.env.JUDGE_REASONING_EFFORT,
  };
}

/**
 * Resolution precedence from specs/judge-jobs.md. Case pins are accepted in
 * either the schema's judge_harness/judge_model spelling or the normalized
 * source/model spelling used by job receipts.
 */
export function resolveJudgeSelection(opts: {
  casePin?: JudgeCasePin | null;
  job?: JudgeSelectionInput | JudgeSelection | null;
  environment?: JudgeSelectionInput | null;
  settings?: JudgeSelectionInput | null;
} = {}): JudgeSelection {
  const pin = opts.casePin;
  const pinSource = sourceOf(pin) ?? normalizeJudgeSource(pin?.judge_harness);
  const pinModel = modelOf(pin) ?? clean(pin?.judge_model);
  if (pinSource || pinModel || effortOf(pin)) {
    return makeJudgeSelection({ source: pinSource, model: pinModel, reasoningEffort: effortOf(pin), resolution: "case" });
  }
  // A checked, persisted job selection is already immutable and ready. Keep
  // its provenance/readiness intact instead of reconstructing an "unknown"
  // selection that would probe the provider again for every rubric.
  if (opts.job && "resolution" in opts.job) return opts.job;
  if (sourceOf(opts.job) || modelOf(opts.job) || effortOf(opts.job)) {
    return makeJudgeSelection({ ...opts.job, resolution: "job" });
  }
  const environment = opts.environment ?? envInput();
  if (sourceOf(environment) || modelOf(environment) || effortOf(environment)) {
    return makeJudgeSelection({ ...environment, resolution: "environment" });
  }
  const rawSettings = (opts.settings ?? readAppSettings()) as JudgeSelectionInput & { judgeSource?: string; judgeModel?: string };
  const settings: JudgeSelectionInput = {
    source: rawSettings.source ?? rawSettings.judgeSource,
    model: rawSettings.model ?? rawSettings.judgeModel,
    reasoningEffort: rawSettings.reasoningEffort,
  };
  if (sourceOf(settings) || modelOf(settings)) {
    return makeJudgeSelection({ source: settings.source, model: settings.model, reasoningEffort: settings.reasoningEffort, resolution: "settings" });
  }
  return makeJudgeSelection({ resolution: "fallback" });
}

export async function checkJudgeSelection(selection: JudgeSelection): Promise<JudgeSelection> {
  const modelIsValid = selection.source === DETERMINISTIC_JUDGE_SOURCE
    ? selection.model === DETERMINISTIC_JUDGE_MODEL
    : selection.source === "openrouter"
      ? Boolean(selection.model)
      : (() => {
        try {
          const models = getAdapter(selection.source).descriptor.models?.aliases;
          return !models || models.length === 0 || models.some((model) => model.id === selection.model || model.label === selection.model);
        } catch { return false; }
      })();
  if (!modelIsValid) return freezeSelection({ ...selection, readiness: "unavailable", readinessDetail: `model ${selection.model} is not registered for source ${selection.source}` });
  const forbidden = new Set((process.env.OPENEVAL_FORBIDDEN_JUDGE_SOURCES ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  if (forbidden.has(selection.source)) return freezeSelection({ ...selection, readiness: "forbidden", readinessDetail: "source is forbidden by environment policy" });
  if (selection.source === DETERMINISTIC_JUDGE_SOURCE) return freezeSelection({ ...selection, readiness: "ready", readinessDetail: "deterministic local stub" });
  if (selection.source === "openrouter") {
    return freezeSelection({ ...selection, readiness: process.env.OPENROUTER_API_KEY ? "ready" : "unavailable", readinessDetail: process.env.OPENROUTER_API_KEY ? "API key detected" : "OPENROUTER_API_KEY not set" });
  }
  if (!hasAdapter(selection.source)) return freezeSelection({ ...selection, readiness: "unavailable", readinessDetail: "judge source is not registered" });
  const probe = await probeHarness(selection.source).catch(() => null);
  return freezeSelection({ ...selection, readiness: probe?.status === "available" ? "ready" : "unavailable", readinessDetail: probe?.detail ?? (probe?.status === "available" ? "CLI available" : "CLI unavailable") });
}

export async function requireReadyJudgeSelection(input: JudgeSelectionInput | JudgeSelection): Promise<JudgeSelection> {
  const base = "resolution" in input ? input : makeJudgeSelection({ ...input, resolution: "job" });
  const checked = await checkJudgeSelection(base);
  if (checked.readiness !== "ready") {
    const reason = checked.readinessDetail || (checked.readiness === "forbidden" ? "forbidden by environment policy" : `source is ${checked.readiness}`);
    throw new Error(`Judge selection ${checked.judgeName} rejected: ${reason}`);
  }
  return checked;
}
