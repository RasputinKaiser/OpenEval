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
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
  const out: SeriesPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const from = Math.max(0, i - window + 1);
    const slice = points.slice(from, i + 1).map(pick);
    out.push({ at: points[i].at, value: median(slice), n: slice.length });
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
 */
export function markerImpact(points: SessionPoint[], marker: Marker, window = 20, minSamples = 5): MarkerImpact {
  const before = points.filter((p) => p.at < marker.firstSeenAt).slice(-window);
  const after = points.filter((p) => p.at >= marker.firstSeenAt).slice(0, window);
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
