/** Browser-safe analytical contracts. Bounds are inclusive below, exclusive above. */
export interface ChartSelection {
  fromMs?: number;
  toMs?: number;
  source?: string;
  model?: string;
  tool?: string;
  weekday?: number; // Monday first, local time (matches the Collection heatmap)
  hour?: number; // local time
  metric?: "tokens" | "duration";
  min?: number;
  max?: number;
  outcome?: "judged" | "heuristic";
  costSource?: "measured" | "inferred";
}

export interface ChartEvidence {
  population: number;
  eligible?: number;
  plotted?: number;
  scope: string;
  provenance?: string;
  generatedAtMs?: number | null;
  stale?: boolean;
  partial?: boolean;
}

export const SELECTION_PARAMS: Record<keyof ChartSelection, string> = {
  fromMs: "vizFrom", toMs: "vizTo", source: "vizSource", model: "vizModel", tool: "vizTool",
  weekday: "vizWeekday", hour: "vizHour", metric: "vizMetric", min: "vizMin", max: "vizMax",
  outcome: "vizOutcome", costSource: "vizCostSource",
};

export function selectionParams(selection: ChartSelection, base = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const [key, param] of Object.entries(SELECTION_PARAMS)) {
    const value = selection[key as keyof ChartSelection];
    if (value === undefined || value === "") params.delete(param);
    else params.set(param, String(value));
  }
  return params;
}

export function parseChartSelection(params: URLSearchParams): { selection: ChartSelection; error?: string } {
  const selection: ChartSelection = {};
  for (const key of ["fromMs", "toMs", "weekday", "hour", "min", "max"] as const) {
    const raw = params.get(SELECTION_PARAMS[key]);
    if (raw === null) continue;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0) return { selection: {}, error: `Invalid ${key} bound.` };
    if ((key === "weekday" && (!Number.isInteger(value) || value > 6)) || (key === "hour" && (!Number.isInteger(value) || value > 23))) return { selection: {}, error: `Invalid ${key}.` };
    if ((key === "fromMs" || key === "toMs") && (!Number.isInteger(value) || value > 8.64e15)) return { selection: {}, error: "Invalid date range." };
    selection[key] = value;
  }
  for (const key of ["source", "model", "tool"] as const) {
    const raw = params.get(SELECTION_PARAMS[key]);
    if (raw === null) continue;
    if (!raw.trim() || raw.length > 256 || /[\x00-\x1f]/.test(raw)) return { selection: {}, error: `Invalid ${key} selection.` };
    selection[key] = raw;
  }
  const metric = params.get(SELECTION_PARAMS.metric);
  if (metric !== null) {
    if (metric !== "tokens" && metric !== "duration") return { selection: {}, error: "Unknown distribution metric." };
    selection.metric = metric;
  }
  const outcome = params.get(SELECTION_PARAMS.outcome);
  if (outcome !== null) {
    if (outcome !== "judged" && outcome !== "heuristic") return { selection: {}, error: "Unknown outcome provenance." };
    selection.outcome = outcome;
  }
  const costSource = params.get(SELECTION_PARAMS.costSource);
  if (costSource !== null) {
    if (costSource !== "measured" && costSource !== "inferred") return { selection: {}, error: "Unknown cost provenance." };
    selection.costSource = costSource;
  }
  if (selection.fromMs !== undefined && selection.toMs !== undefined && selection.fromMs >= selection.toMs) return { selection: {}, error: "End date must follow start date." };
  if (selection.min !== undefined && selection.max !== undefined && selection.min >= selection.max) return { selection: {}, error: "Upper bound must exceed lower bound." };
  if ((selection.min !== undefined || selection.max !== undefined) && !selection.metric) return { selection: {}, error: "A distribution bound requires a metric." };
  return { selection };
}

export function chartSelectionHref(path: string, selection: ChartSelection): string {
  const params = selectionParams(selection).toString();
  return `${path}${params ? `?${params}` : ""}`;
}

export function inRange(value: number, min?: number, max?: number): boolean {
  return Number.isFinite(value) && (min === undefined || value >= min) && (max === undefined || value < max);
}

/** Even chronological coverage, including both endpoints; never changes source statistics. */
export function sampleEvenly<T>(points: readonly T[], cap: number): T[] {
  const limit = Math.max(0, Math.floor(cap));
  if (!limit) return [];
  if (points.length <= limit) return [...points];
  if (limit === 1) return [points[Math.floor((points.length - 1) / 2)]];
  return Array.from({ length: limit }, (_, i) => points[Math.floor(i * (points.length - 1) / (limit - 1))]);
}

export interface HistogramBin { min: number; max?: number; count: number; }
/** Fixed logarithmic bins retain an explicit zero bucket and an open final bucket. */
export function histogram(values: readonly number[], metric: "tokens" | "duration"): { bins: HistogramBin[]; eligible: number; missing: number } {
  const edges = metric === "tokens" ? [0, 1, 1_000, 10_000, 100_000, 1_000_000, 10_000_000] : [0, 1, 1_000, 10_000, 60_000, 600_000, 3_600_000];
  const bins = edges.map((min, i) => ({ min, ...(edges[i + 1] === undefined ? {} : { max: edges[i + 1] }), count: 0 }));
  let missing = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) { missing++; continue; }
    const index = edges.findIndex((_, i) => i === edges.length - 1 || value < edges[i + 1]);
    bins[index].count++;
  }
  return { bins, eligible: values.length - missing, missing };
}

export function logDomain(values: readonly number[]): { min: number; max: number; ticks: number[] } | null {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!positive.length) return null;
  let low = Infinity, high = 0;
  for (const v of positive) { low = Math.min(low, v); high = Math.max(high, v); }
  let min = Math.floor(Math.log10(low)), max = Math.ceil(Math.log10(high));
  if (min === max) { min -= 0.5; max += 0.5; }
  // Bounds are logarithms, avoiding overflow when data spans many decades.
  const step = Math.max(1, Math.ceil((max - min) / 5));
  const ticks: number[] = [];
  for (let exponent = Math.ceil(min); exponent <= max; exponent += step) {
    const tick = 10 ** exponent;
    if (Number.isFinite(tick) && tick > 0) ticks.push(tick);
  }
  return { min, max, ticks };
}
