// Pure helpers for the New Run wizard. Kept free of React/DOM imports so the
// validation rules — which mirror app/api/runs/route.ts POST — are unit-testable.

export const RUN_INT_MIN = 1;
export const RUN_INT_MAX = 8;

export interface ParsedBoundedInt {
  value: number | null;
  error: string | null;
}

/**
 * Parse a numeric wizard field the same way the API treats it, but instead of
 * silently clamping (the API's backstop behavior) return an inline error so
 * the user fixes the value before submitting.
 */
export function parseBoundedInt(raw: string, min = RUN_INT_MIN, max = RUN_INT_MAX): ParsedBoundedInt {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: `Required — enter a whole number between ${min} and ${max}.` };
  if (!/^[+-]?\d+$/.test(trimmed)) return { value: null, error: `Must be a whole number between ${min} and ${max}.` };
  const n = Number.parseInt(trimmed, 10);
  if (n < min || n > max) return { value: null, error: `Must be between ${min} and ${max}.` };
  return { value: n, error: null };
}

export type RunField = "caseIds" | "harness" | "model" | "parallel" | "samples" | "runner" | "name";

const RUN_FIELDS: RunField[] = ["caseIds", "harness", "model", "parallel", "samples", "runner", "name"];

export function isRunField(value: unknown): value is RunField {
  return typeof value === "string" && (RUN_FIELDS as string[]).includes(value);
}

/**
 * Map an API error message to the wizard field it concerns, so a 400 renders
 * next to the offending control instead of as a bare generic error.
 */
export function inferErrorField(message: string): RunField | null {
  const m = message.toLowerCase();
  if (m.includes("caseid") || m.includes("case id") || m.includes("no cases match")) return "caseIds";
  if (m.includes("harness")) return "harness";
  if (m.includes("model")) return "model";
  if (m.includes("parallel")) return "parallel";
  if (m.includes("sample")) return "samples";
  if (m.includes("runner")) return "runner";
  return null;
}

export interface RunSummaryParts {
  caseCount: number;
  samples: number | null;
  parallel: number | null;
  harnessLabel: string;
  modelLabel: string;
}

/** "12 cases × 2 samples on claude-code / opus, parallelism 4" */
export function buildRunSentence(p: RunSummaryParts): string {
  const cases = `${p.caseCount} case${p.caseCount === 1 ? "" : "s"}`;
  const samples = p.samples == null ? "? samples" : `${p.samples} sample${p.samples === 1 ? "" : "s"}`;
  const parallel = p.parallel == null ? "?" : String(p.parallel);
  return `${cases} × ${samples} on ${p.harnessLabel} / ${p.modelLabel}, parallelism ${parallel}`;
}
