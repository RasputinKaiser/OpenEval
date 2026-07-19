import type { LiveSession } from "../live";
import type { StoredJudgment } from "../live-cache";
import { scoreOutcome } from "./outcome";

export interface SessionPoint {
  sessionId: string;
  at: number;
  source: string;
  model: string | null;
  path: string | null;
  outcome: number;
  outcomeHasSignal: boolean;
  outcomeProvenance: "heuristic" | "judged";
  outcomeReasons: string[];
  costUsd: number;
  toolErrorRate: number;
  toolCallsPerTurn: number;
  subagentSpawns: number;
  durationMin: number;
  skills: string[];
  mcpServers: string[];
}

export type MarkerKind = "skill" | "mcp" | "subagent" | "model";

export interface Marker {
  kind: MarkerKind;
  name: string;
  firstSeenAt: number;
  sessionCount: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return (xs[0] + xs[1]) / 2; // sum is order-independent — no sort needed
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** First index in `points` (sorted ascending by `at`) whose `at` is >= t. */
const lowerBoundAt = (points: SessionPoint[], t: number): number => {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].at < t) lo = mid + 1; else hi = mid;
  }
  return lo;
};

/** Insert v into an ascending-sorted array, keeping it sorted. */
const insertSorted = (arr: number[], v: number): void => {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= v) lo = mid + 1; else hi = mid;
  }
  arr.splice(lo, 0, v);
};

/** Remove one occurrence of v (known to be present) from an ascending-sorted array. */
const removeSorted = (arr: number[], v: number): void => {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  arr.splice(lo, 1);
};

const mode = <T>(xs: T[]): T | null => {
  const counts = new Map<T, number>();
  let best: T | null = null, bestN = 0;
  for (const x of xs) {
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) { bestN = n; best = x; }
  }
  return best;
};

/**
 * Build time-ordered points from source-labeled sessions. When a persisted
 * LLM-judge verdict exists for a session's file, it replaces the heuristic
 * score (provenance "judged") — a judged verdict always counts as a signal.
 */
export function toPoints(
  sessions: Array<LiveSession & { sourceLabel?: string }>,
  judgments?: Map<string, StoredJudgment>,
): SessionPoint[] {
  return sessions
    .map((s) => {
      const o = scoreOutcome(s);
      const j = s.path ? judgments?.get(s.path) : undefined;
      return {
        sessionId: s.sessionId,
        at: s.startedAt,
        source: s.sourceLabel ?? "?",
        model: s.model,
        path: s.path ?? null,
        outcome: j ? j.score : o.score,
        outcomeHasSignal: j ? true : o.hasSignal,
        outcomeProvenance: (j ? "judged" : "heuristic") as "heuristic" | "judged",
        outcomeReasons: j ? j.reasons : o.reasons,
        costUsd: s.costUsd || 0,
        toolErrorRate: s.toolErrorRate || 0,
        toolCallsPerTurn: s.toolCallsPerTurn || 0,
        subagentSpawns: s.subagentSpawns || 0,
        durationMin: (s.durationMs || 0) / 60000,
        skills: s.skillsUsed ?? [],
        mcpServers: s.mcpServersUsed ?? [],
      };
    })
    .filter((p) => Number.isFinite(p.at) && p.at > 0)
    .sort((a, b) => a.at - b.at);
}

/** First-seen date + usage count for every skill, MCP server, model, and subagent use. */
export function detectMarkers(points: SessionPoint[]): Marker[] {
  const skill = new Map<string, { at: number; n: number }>();
  const mcp = new Map<string, { at: number; n: number }>();
  const model = new Map<string, { at: number; n: number }>();
  let subagentAt: number | null = null, subagentN = 0;

  for (const p of points) {
    for (const s of p.skills) {
      const e = skill.get(s); if (e) e.n++; else skill.set(s, { at: p.at, n: 1 });
    }
    for (const m of p.mcpServers) {
      const e = mcp.get(m); if (e) e.n++; else mcp.set(m, { at: p.at, n: 1 });
    }
    if (p.model) {
      const e = model.get(p.model); if (e) e.n++; else model.set(p.model, { at: p.at, n: 1 });
    }
    if (p.subagentSpawns > 0) { subagentN++; if (subagentAt == null) subagentAt = p.at; }
  }

  const out: Marker[] = [];
  const push = (kind: MarkerKind, map: Map<string, { at: number; n: number }>) => {
    for (const [name, e] of map) out.push({ kind, name, firstSeenAt: e.at, sessionCount: e.n });
  };
  push("skill", skill);
  push("mcp", mcp);
  push("model", model);
  if (subagentAt != null) out.push({ kind: "subagent", name: "subagent usage", firstSeenAt: subagentAt, sessionCount: subagentN });
  return out.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
}

export interface SeriesPoint { at: number; value: number; n: number }

/** Trailing-window median of a metric — smooths the noise of per-session values. */
export function metricSeries(points: SessionPoint[], pick: (p: SessionPoint) => number, window = 15): SeriesPoint[] {
  if (!Number.isInteger(window) || window < 1) {
    // Degenerate windows: keep the original per-index semantics verbatim.
    const out: SeriesPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const from = Math.max(0, i - window + 1);
      const slice = points.slice(from, i + 1).map(pick);
      out.push({ at: points[i].at, value: median(slice), n: slice.length });
    }
    return out;
  }
  // Sliding sorted window instead of a per-index slice+sort — O(N×window)
  // element moves with no per-index array allocations.
  const out: SeriesPoint[] = [];
  const vals: number[] = new Array(points.length);
  const win: number[] = []; // sorted values of the current window (NaNs excluded)
  let nanInWindow = 0;
  for (let i = 0; i < points.length; i++) {
    const v = (vals[i] = pick(points[i]));
    if (Number.isNaN(v)) nanInWindow++; else insertSorted(win, v);
    const outIdx = i - window;
    if (outIdx >= 0) {
      const o = vals[outIdx];
      if (Number.isNaN(o)) nanInWindow--; else removeSorted(win, o);
    }
    const n = i < window ? i + 1 : window;
    let value: number;
    if (nanInWindow === 0) {
      const m = win.length >> 1;
      value = win.length % 2 ? win[m] : (win[m - 1] + win[m]) / 2;
    } else {
      // NaN comparisons make sorted-window maintenance unreliable — recompute
      // this index the original way so behavior is bit-identical.
      value = median(vals.slice(i - n + 1, i + 1));
    }
    out.push({ at: points[i].at, value, n });
  }
  return out;
}

export interface MetricAgg {
  outcome: number;
  toolErrorRate: number;
  costUsd: number;
  toolCallsPerTurn: number;
  subagentRate: number;
  durationMin: number;
}

const MIN_JUDGED_FOR_MEDIAN = 5;

type OutcomePool = "judged" | "heuristic";

function aggregate(points: SessionPoint[]): { agg: MetricAgg; outcomePool: OutcomePool } {
  // Judged verdicts are strictly better signal than the heuristic — once a
  // window has enough of them, the heuristic scores only add noise.
  const judged = points.filter((p) => p.outcomeProvenance === "judged");
  const useJudged = judged.length >= MIN_JUDGED_FOR_MEDIAN;
  const outcomePool = useJudged ? judged : points.filter((p) => p.outcomeHasSignal);
  const agg: MetricAgg = {
    outcome: median(outcomePool.map((p) => p.outcome)),
    toolErrorRate: median(points.map((p) => p.toolErrorRate)),
    costUsd: median(points.map((p) => p.costUsd)),
    toolCallsPerTurn: median(points.map((p) => p.toolCallsPerTurn)),
    subagentRate: points.length ? points.filter((p) => p.subagentSpawns > 0).length / points.length : 0,
    durationMin: median(points.map((p) => p.durationMin)),
  };
  return { agg, outcomePool: useJudged ? "judged" : "heuristic" };
}

export interface MarkerImpact {
  marker: Marker;
  nBefore: number;
  nAfter: number;
  /** LLM-judged sessions per side; when ≥5 on a side, its outcome median uses judged verdicts only. */
  judgedBefore: number;
  judgedAfter: number;
  before: MetricAgg;
  after: MetricAgg;
  deltas: MetricAgg;
  confounds: string[];
  lowConfidence: boolean;
}

/**
 * Compare the `window` sessions just before a marker's adoption to the `window`
 * just after. Correlational only — so co-occurring changes (a model switch, thin
 * samples) are surfaced as confounds rather than hidden.
 *
 * `points` must be sorted ascending by `at` (as `toPoints` returns them): the
 * before/after windows are taken as contiguous ranges around the marker's
 * boundary index (binary search) instead of two full-array filters per marker.
 */
export function markerImpact(points: SessionPoint[], marker: Marker, window = 20, minSamples = 5): MarkerImpact {
  let before: SessionPoint[], after: SessionPoint[];
  if (Number.isInteger(window) && window >= 1) {
    const split = lowerBoundAt(points, marker.firstSeenAt); // first index with at >= firstSeenAt
    before = points.slice(Math.max(0, split - window), split);
    after = points.slice(split, split + window);
  } else {
    // Degenerate windows: keep the original filter+slice semantics verbatim
    // (slice(-0) takes the whole prefix, fractional windows truncate).
    before = points.filter((p) => p.at < marker.firstSeenAt).slice(-window);
    after = points.filter((p) => p.at >= marker.firstSeenAt).slice(0, window);
  }
  const { agg: a, outcomePool: poolBefore } = aggregate(before);
  const { agg: b, outcomePool: poolAfter } = aggregate(after);
  const deltas: MetricAgg = {
    outcome: b.outcome - a.outcome,
    toolErrorRate: b.toolErrorRate - a.toolErrorRate,
    costUsd: b.costUsd - a.costUsd,
    toolCallsPerTurn: b.toolCallsPerTurn - a.toolCallsPerTurn,
    subagentRate: b.subagentRate - a.subagentRate,
    durationMin: b.durationMin - a.durationMin,
  };
  const confounds: string[] = [];
  const beforeModel = mode(before.map((p) => p.model).filter(Boolean) as string[]);
  const afterModel = mode(after.map((p) => p.model).filter(Boolean) as string[]);
  if (beforeModel && afterModel && beforeModel !== afterModel) {
    confounds.push(`dominant model changed ${beforeModel} → ${afterModel} around this point`);
  }
  // A delta whose sides come from different scoring instruments measures the
  // instrument switch, not the marker: heuristic scores cluster near the 0.5
  // prior while judged scores use the full 0..1 range.
  if (poolBefore !== poolAfter) {
    confounds.push(`outcome medians mix ${poolAfter} (after) with ${poolBefore} (before) scores`);
  }
  const lowConfidence = before.length < minSamples || after.length < minSamples;
  if (lowConfidence) confounds.push(`thin sample (${before.length} before / ${after.length} after)`);
  return {
    marker,
    nBefore: before.length,
    nAfter: after.length,
    judgedBefore: before.filter((p) => p.outcomeProvenance === "judged").length,
    judgedAfter: after.filter((p) => p.outcomeProvenance === "judged").length,
    before: a,
    after: b,
    deltas,
    confounds,
    lowConfidence,
  };
}
