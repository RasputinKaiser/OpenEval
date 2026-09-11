import fs from "node:fs";
import type { LiveSession, MetricSource } from "../live";
import type { StoredJudgment } from "../live-cache";
import type { JudgeSelection } from "../grader/selection";
import { scoreOutcome } from "./outcome";

export type OutcomeProvenance = "heuristic" | "judged" | "unavailable";
export type EvidenceProvenance = "judged" | "heuristic" | "observed" | "measured" | "inferred" | "mixed" | "unavailable";
export type ImpactMetric = "outcome" | "toolErrorRate" | "costUsd" | "toolCallsPerTurn" | "subagentRate" | "durationMin";

export interface MetricEvidence {
  /** Number of finite observations actually used for this metric. */
  n: number;
  /** Instrument/source provenance for those observations. */
  provenance: EvidenceProvenance;
}

export type MetricEvidenceSet = Record<ImpactMetric, MetricEvidence>;

export interface SessionPoint {
  sessionId: string;
  /** Source-qualified identity is optional for legacy direct callers. */
  sourceId?: string;
  at: number;
  source: string;
  model: string | null;
  path: string | null;
  outcome: number;
  outcomeHasSignal: boolean;
  outcomeProvenance: OutcomeProvenance;
  outcomeReasons: string[];
  costUsd: number;
  /** Cost source is kept separate from its numeric value so measured $0 is real evidence. */
  costSource?: MetricSource | "unavailable";
  costAvailable?: boolean;
  toolErrorRate: number;
  toolCallsPerTurn: number;
  subagentSpawns: number;
  durationMin: number;
  skills: string[];
  mcpServers: string[];
  judgeSelection?: JudgeSelection;
  judgePromptVersion?: number | null;
}

export type MarkerKind = "skill" | "mcp" | "subagent" | "model";
export type MarkerEvidenceScope = "top-level" | "child";

export interface Marker {
  kind: MarkerKind;
  name: string;
  firstSeenAt: number;
  /** Top-level sessions using this marker; this is the outcome/impact denominator. */
  sessionCount: number;
  /** Where this marker was observed; collection merges top-level and child evidence. */
  observedIn?: MarkerEvidenceScope | "both";
  /** Total retained traces carrying this marker, including child traces. */
  evidenceSessionCount?: number;
  /** Child-trace count kept separate from the top-level denominator. */
  childSessionCount?: number;
  /** First-seen timestamps by trace scope; `firstSeenAt` is top-level when available. */
  topLevelFirstSeenAt?: number;
  childFirstSeenAt?: number;
  topLevelSessionCount?: number;
}

const median = (xs: number[]): number => {
  const finite = xs.filter(Number.isFinite);
  if (finite.length === 0) return 0;
  if (finite.length === 1) return finite[0];
  if (finite.length === 2) return (finite[0] + finite[1]) / 2; // sum is order-independent — no sort needed
  const s = [...finite].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const average = (xs: number[]): number => {
  const finite = xs.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
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

/** A receipt is only comparable to the transcript revision it judged. */
function judgmentMatchesSession(session: LiveSession, judgment: StoredJudgment): boolean {
  // Pre-revision receipts used 0 as an informational timestamp. Keep those
  // readable for backwards compatibility; new receipts always persist mtime.
  if (judgment.mtimeMs <= 0 || !session.path) return true;
  try {
    return fs.statSync(session.path).mtimeMs === judgment.mtimeMs;
  } catch {
    return false;
  }
}

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
      const candidate = s.path ? judgments?.get(s.path) : undefined;
      const j = candidate && judgmentMatchesSession(s, candidate) && Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1
        ? candidate
        : undefined;
      const costSource = s.metricSources?.cost ?? "missing";
      const rawCost = Number.isFinite(s.costUsd) && s.costUsd >= 0 ? s.costUsd : 0;
      const costAvailable = costSource === "measured"
        ? Number.isFinite(s.costUsd) && s.costUsd >= 0
        : costSource === "inferred"
          ? Number.isFinite(s.costUsd) && s.costUsd > 0
          : false;
      return {
        sessionId: s.sessionId,
        ...(typeof (s as { sourceId?: unknown }).sourceId === "string" ? { sourceId: (s as unknown as { sourceId: string }).sourceId } : {}),
        at: s.startedAt,
        source: s.sourceLabel ?? "?",
        model: s.model,
        path: s.path ?? null,
        outcome: j ? j.score : o.score,
        outcomeHasSignal: j ? true : o.hasSignal,
        outcomeProvenance: (j ? "judged" : o.hasSignal ? "heuristic" : "unavailable") as OutcomeProvenance,
        outcomeReasons: j ? j.reasons : o.reasons,
        judgeSelection: j?.selection,
        judgePromptVersion: j?.promptVersion ?? null,
        costUsd: rawCost,
        costSource,
        costAvailable,
        toolErrorRate: Number.isFinite(s.toolErrorRate) ? s.toolErrorRate : 0,
        toolCallsPerTurn: Number.isFinite(s.toolCallsPerTurn) ? s.toolCallsPerTurn : 0,
        subagentSpawns: Number.isFinite(s.subagentSpawns) ? Math.max(0, s.subagentSpawns) : 0,
        durationMin: Number.isFinite(s.durationMs) && s.durationMs >= 0 ? s.durationMs / 60000 : 0,
        skills: s.skillsUsed ?? [],
        mcpServers: s.mcpServersUsed ?? [],
      };
    })
    .filter((p) => Number.isFinite(p.at) && p.at > 0)
    .sort((a, b) => a.at - b.at);
}

/** First-seen date + usage count for every skill, MCP server, model, and subagent use. */
export function detectMarkers(points: SessionPoint[], observedIn: MarkerEvidenceScope = "top-level"): Marker[] {
  const skill = new Map<string, { at: number; n: number }>();
  const mcp = new Map<string, { at: number; n: number }>();
  const model = new Map<string, { at: number; n: number }>();
  let subagentAt: number | null = null, subagentN = 0;

  for (const p of points) {
    // A malformed parser payload can repeat a marker in one session. Marker
    // counts are session denominators, so count each name once per point.
    for (const s of new Set(p.skills.filter(Boolean))) {
      const e = skill.get(s); if (e) e.n++; else skill.set(s, { at: p.at, n: 1 });
    }
    for (const m of new Set(p.mcpServers.filter(Boolean))) {
      const e = mcp.get(m); if (e) e.n++; else mcp.set(m, { at: p.at, n: 1 });
    }
    if (p.model) {
      const e = model.get(p.model); if (e) e.n++; else model.set(p.model, { at: p.at, n: 1 });
    }
    if (p.subagentSpawns > 0) { subagentN++; if (subagentAt == null) subagentAt = p.at; }
  }

  const out: Marker[] = [];
  const push = (kind: MarkerKind, map: Map<string, { at: number; n: number }>) => {
    for (const [name, e] of map) out.push({
      kind,
      name,
      firstSeenAt: e.at,
      sessionCount: e.n,
      evidenceSessionCount: e.n,
      observedIn,
      ...(observedIn === "top-level"
        ? { topLevelFirstSeenAt: e.at, topLevelSessionCount: e.n }
        : { childFirstSeenAt: e.at, childSessionCount: e.n, topLevelSessionCount: 0 }),
    });
  };
  push("skill", skill);
  push("mcp", mcp);
  push("model", model);
  if (subagentAt != null) out.push({
    kind: "subagent",
    name: "subagent usage",
    firstSeenAt: subagentAt,
    sessionCount: subagentN,
    evidenceSessionCount: subagentN,
    observedIn,
    ...(observedIn === "top-level"
      ? { topLevelFirstSeenAt: subagentAt, topLevelSessionCount: subagentN }
      : { childFirstSeenAt: subagentAt, childSessionCount: subagentN, topLevelSessionCount: 0 }),
  });
  return out.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
}

export interface SeriesPoint { at: number; value: number; n: number }

/** Trailing-window median of a metric — smooths the noise of per-session values. */
export function metricSeries(points: SessionPoint[], pick: (p: SessionPoint) => number, window = 15): SeriesPoint[] {
  // Invalid windows used to produce surprising negative/empty slices. A
  // deterministic one-session fallback keeps the chart finite and explicit.
  const effectiveWindow = Number.isInteger(window) && window >= 1 ? window : 1;
  // Sliding sorted window instead of a per-index slice+sort — O(N×window)
  // element moves with no per-index array allocations.
  const out: SeriesPoint[] = [];
  const vals: number[] = new Array(points.length);
  const win: number[] = []; // sorted values of the current window (NaNs excluded)
  let invalidInWindow = 0;
  for (let i = 0; i < points.length; i++) {
    const v = (vals[i] = pick(points[i]));
    if (!Number.isFinite(v)) invalidInWindow++; else insertSorted(win, v);
    const outIdx = i - effectiveWindow;
    if (outIdx >= 0) {
      const o = vals[outIdx];
      if (!Number.isFinite(o)) invalidInWindow--; else removeSorted(win, o);
    }
    const n = win.length;
    let value: number;
    if (invalidInWindow === 0) {
      const m = win.length >> 1;
      value = win.length % 2 ? win[m] : (win[m - 1] + win[m]) / 2;
    } else {
      // NaN comparisons make sorted-window maintenance unreliable — recompute
      // this index the original way so behavior is bit-identical.
      const from = Math.max(0, i - effectiveWindow + 1);
      const slice = vals.slice(from, i + 1).filter(Number.isFinite);
      value = slice.length ? median(slice) : Number.NaN;
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

export type OutcomePool = "judged" | "signal";

/**
 * Evidence basis for the plotted outcome series. `n` is the number of source
 * observations before the chart is downsampled; `denominator` is the complete
 * top-level session population in the report. Keeping both prevents a chart
 * with 80 plotted points from looking like an 80-session population report.
 */
export interface OutcomeSeriesEvidence {
  n: number;
  denominator: number;
  coverage: number;
  pool: OutcomePool;
  provenance: OutcomeProvenance | "mixed";
}

const emptyEvidence = (): MetricEvidence => ({ n: 0, provenance: "unavailable" });

function outcomeEvidence(points: SessionPoint[]): MetricEvidence {
  const judged = points.filter((p) => p.outcomeProvenance === "judged").length;
  const heuristic = points.filter((p) => p.outcomeProvenance === "heuristic").length;
  if (judged === 0 && heuristic === 0) return emptyEvidence();
  return {
    n: judged + heuristic,
    provenance: judged > 0 && heuristic > 0 ? "mixed" : judged > 0 ? "judged" : "heuristic",
  };
}

function costAvailable(point: SessionPoint): boolean {
  if (point.costAvailable !== undefined) return point.costAvailable && Number.isFinite(point.costUsd);
  if (point.costSource === "measured") return Number.isFinite(point.costUsd) && point.costUsd >= 0;
  if (point.costSource === "inferred") return Number.isFinite(point.costUsd) && point.costUsd > 0;
  // Compatibility for callers constructing SessionPoint directly before the
  // source field existed; toPoints always supplies the stricter source-aware flag.
  return point.costSource === undefined && Number.isFinite(point.costUsd);
}

function costEvidence(points: SessionPoint[]): { values: number[]; evidence: MetricEvidence } {
  const usable = points.filter(costAvailable);
  const measured = usable.filter((p) => p.costSource === "measured").length;
  const inferred = usable.filter((p) => p.costSource === "inferred" || p.costSource === undefined).length;
  const provenance: EvidenceProvenance = usable.length === 0
    ? "unavailable"
    : measured > 0 && inferred > 0
      ? "mixed"
      : measured > 0
        ? "measured"
        : "inferred";
  return { values: usable.map((p) => p.costUsd), evidence: { n: usable.length, provenance } };
}

function observedEvidence(points: SessionPoint[], pick: (p: SessionPoint) => number): { values: number[]; evidence: MetricEvidence } {
  const values = points.map(pick).filter(Number.isFinite);
  return { values, evidence: values.length ? { n: values.length, provenance: "observed" } : emptyEvidence() };
}

function makeEvidenceSet(points: SessionPoint[], outcomePool: SessionPoint[]): MetricEvidenceSet {
  const toolErrors = observedEvidence(points, (p) => p.toolErrorRate);
  const toolCalls = observedEvidence(points, (p) => p.toolCallsPerTurn);
  const costs = costEvidence(points);
  const duration = observedEvidence(points, (p) => p.durationMin);
  return {
    outcome: outcomeEvidence(outcomePool),
    toolErrorRate: toolErrors.evidence,
    costUsd: costs.evidence,
    toolCallsPerTurn: toolCalls.evidence,
    subagentRate: points.length ? { n: points.length, provenance: "observed" } : emptyEvidence(),
    durationMin: duration.evidence,
  };
}

function aggregate(points: SessionPoint[]): {
  agg: MetricAgg;
  outcomePool: OutcomePool;
  outcomeSampleSize: number;
  signalCount: number;
  judgedCount: number;
  evidence: MetricEvidenceSet;
} {
  // Judged verdicts are strictly better signal than the heuristic — once a
  // window has enough of them, the heuristic scores only add noise.
  const judged = points.filter((p) => p.outcomeProvenance === "judged");
  const withSignal = points.filter((p) => p.outcomeHasSignal);
  const useJudged = judged.length >= MIN_JUDGED_FOR_MEDIAN;
  const outcomePool = useJudged ? judged : withSignal;
  const toolErrors = observedEvidence(points, (p) => p.toolErrorRate);
  const toolCalls = observedEvidence(points, (p) => p.toolCallsPerTurn);
  const costs = costEvidence(points);
  const duration = observedEvidence(points, (p) => p.durationMin);
  const agg: MetricAgg = {
    outcome: median(outcomePool.map((p) => p.outcome)),
    toolErrorRate: median(toolErrors.values),
    costUsd: median(costs.values),
    toolCallsPerTurn: median(toolCalls.values),
    subagentRate: points.length ? points.filter((p) => p.subagentSpawns > 0).length / points.length : 0,
    durationMin: median(duration.values),
  };
  return {
    agg,
    outcomePool: useJudged ? "judged" : "signal",
    outcomeSampleSize: outcomePool.length,
    signalCount: withSignal.length,
    judgedCount: judged.length,
    evidence: makeEvidenceSet(points, outcomePool),
  };
}

export interface MarkerImpact {
  marker: Marker;
  nBefore: number;
  nAfter: number;
  /** LLM-judged sessions per side; when ≥5 on a side, its outcome median uses judged verdicts only. */
  judgedBefore: number;
  judgedAfter: number;
  /** Sessions with any usable outcome signal in each full comparison window. */
  signalBefore: number;
  signalAfter: number;
  /** Actual denominator used by each outcome median after judged-pool selection. */
  outcomeNBefore: number;
  outcomeNAfter: number;
  outcomePoolBefore: OutcomePool;
  outcomePoolAfter: OutcomePool;
  /** False when either side has no outcome evidence; the numeric placeholder must not be shown as a measured delta. */
  outcomeComparable: boolean;
  /** False when either side has no sessions; no metric delta is meaningful in that case. */
  windowComparable: boolean;
  /** False when the marker was observed only in child traces, so no top-level effect can be assigned. */
  adoptionComparable: boolean;
  /** Exact finite-observation denominators and provenance for every metric. */
  beforeEvidence: MetricEvidenceSet;
  afterEvidence: MetricEvidenceSet;
  /** Metric-specific gate; thin or source-mismatched values are not decision-grade. */
  metricComparable: Record<ImpactMetric, boolean>;
  /** Standardized outcome difference, withheld when variance or evidence is insufficient. */
  effectSize: number | null;
  effectSizeKind: "standardized-mean-difference" | null;
  strength: "unavailable" | "negligible" | "small" | "moderate" | "large";
  comparability: "comparable" | "thin" | "unavailable" | "mixed-provenance" | "child-only";
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
  const validWindow = Number.isInteger(window) && window >= 1;
  const validBoundary = Number.isFinite(marker.firstSeenAt);
  if (validWindow && validBoundary) {
    const split = lowerBoundAt(points, marker.firstSeenAt); // first index with at >= firstSeenAt
    before = points.slice(Math.max(0, split - window), split);
    after = points.slice(split, split + window);
  } else {
    // Invalid windows/boundaries are explicitly unavailable rather than
    // silently turning into a full-history or one-sided comparison.
    before = [];
    after = [];
  }
  const beforeSummary = aggregate(before);
  const afterSummary = aggregate(after);
  const { agg: a, outcomePool: poolBefore } = beforeSummary;
  const { agg: b, outcomePool: poolAfter } = afterSummary;
  const minN = Number.isInteger(minSamples) && minSamples >= 1 ? minSamples : 5;
  const windowComparable = before.length > 0 && after.length > 0;
  const adoptionComparable = marker.observedIn !== "child"
    && (marker.topLevelSessionCount ?? marker.sessionCount) > 0
    && validBoundary;
  const beforeEvidence = beforeSummary.evidence;
  const afterEvidence = afterSummary.evidence;
  const sameProvenance = (metric: ImpactMetric) => {
    const left = beforeEvidence[metric];
    const right = afterEvidence[metric];
    return left.n >= minN && right.n >= minN
      && left.provenance === right.provenance
      && left.provenance !== "mixed"
      && left.provenance !== "unavailable";
  };
  const metricComparable: Record<ImpactMetric, boolean> = {
    outcome: sameProvenance("outcome") && adoptionComparable,
    toolErrorRate: sameProvenance("toolErrorRate") && windowComparable,
    costUsd: sameProvenance("costUsd") && windowComparable,
    toolCallsPerTurn: sameProvenance("toolCallsPerTurn") && windowComparable,
    subagentRate: sameProvenance("subagentRate") && windowComparable,
    durationMin: sameProvenance("durationMin") && windowComparable,
  };
  const outcomeComparable = metricComparable.outcome;
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
  if (marker.kind === "model") {
    confounds.push("marker is a model change; its outcome shift is inseparable from the model switch");
  }
  const beforeSource = mode(before.map((p) => p.source).filter(Boolean));
  const afterSource = mode(after.map((p) => p.source).filter(Boolean));
  if (beforeSource && afterSource && beforeSource !== afterSource) {
    confounds.push(`dominant source changed ${beforeSource} → ${afterSource} around this point`);
  }
  if (!adoptionComparable) {
    confounds.push(marker.observedIn === "child"
      ? "marker was observed only in child traces; no top-level outcome effect assigned"
      : "marker adoption boundary unavailable in top-level evidence");
  }
  // A delta whose sides come from different scoring instruments measures the
  // instrument switch, not the marker: heuristic scores cluster near the 0.5
  // prior while judged scores use the full 0..1 range.
  if (poolBefore !== poolAfter) {
    confounds.push(`outcome medians mix ${poolAfter} (after) with ${poolBefore} (before) scores`);
  }
  if (beforeEvidence.outcome.provenance !== afterEvidence.outcome.provenance
    || beforeEvidence.outcome.provenance === "mixed"
    || afterEvidence.outcome.provenance === "mixed") {
    confounds.push(`outcome evidence provenance differs (${beforeEvidence.outcome.provenance} before / ${afterEvidence.outcome.provenance} after)`);
  }
  if (!outcomeComparable && beforeSummary.outcomeSampleSize > 0 && afterSummary.outcomeSampleSize > 0) {
    const reason = adoptionComparable ? "thin or mixed-provenance outcome evidence" : "outcome attribution unavailable";
    confounds.push(`${reason} (${beforeSummary.outcomeSampleSize} before / ${afterSummary.outcomeSampleSize} after usable scores)`);
  } else if (!outcomeComparable) {
    confounds.push(
      `outcome unavailable (${beforeSummary.outcomeSampleSize} before / ${afterSummary.outcomeSampleSize} after usable scores)`,
    );
  }
  if (!windowComparable) {
    confounds.push(`comparison window unavailable (${before.length} before / ${after.length} after sessions)`);
  }
  const thinWindow = before.length < minN || after.length < minN;
  const thinOutcome = beforeSummary.outcomeSampleSize < minN || afterSummary.outcomeSampleSize < minN;
  const lowConfidence = thinWindow || thinOutcome;
  if (thinWindow && validWindow) confounds.push(`thin window (${before.length} before / ${after.length} after sessions)`);
  if (!thinWindow && thinOutcome && outcomeComparable) {
    confounds.push(
      `thin outcome evidence (${beforeSummary.outcomeSampleSize} before / ${afterSummary.outcomeSampleSize} after usable scores)`,
    );
  }
  for (const metric of Object.keys(metricComparable) as ImpactMetric[]) {
    if (!metricComparable[metric] && beforeEvidence[metric].n > 0 && afterEvidence[metric].n > 0
      && beforeEvidence[metric].provenance !== afterEvidence[metric].provenance) {
      confounds.push(`${metric} provenance differs (${beforeEvidence[metric].provenance} before / ${afterEvidence[metric].provenance} after)`);
    }
  }

  const outcomeValuesBefore = (beforeSummary.outcomePool === "judged"
    ? before.filter((p) => p.outcomeProvenance === "judged")
    : before.filter((p) => p.outcomeHasSignal))
    .filter((p) => Number.isFinite(p.outcome)).map((p) => p.outcome);
  const outcomeValuesAfter = (afterSummary.outcomePool === "judged"
    ? after.filter((p) => p.outcomeProvenance === "judged")
    : after.filter((p) => p.outcomeHasSignal))
    .filter((p) => Number.isFinite(p.outcome)).map((p) => p.outcome);
  const pooledVariance = (left: number[], right: number[]): number => {
    const n = left.length + right.length;
    if (n < 3) return 0;
    const lm = average(left), rm = average(right);
    // Cohen's d is only a descriptor here; a zero-variance step is withheld
    // rather than converted into fake infinite precision.
    const sum = left.reduce((acc, x) => acc + (x - lm) ** 2, 0) + right.reduce((acc, x) => acc + (x - rm) ** 2, 0);
    return sum / Math.max(1, n - 2);
  };
  const variance = pooledVariance(outcomeValuesBefore, outcomeValuesAfter);
  const rawEffect = outcomeComparable
    ? b.outcome - a.outcome
    : 0;
  const effectSize = outcomeComparable && variance > 1e-12
    ? rawEffect / Math.sqrt(variance)
    : outcomeComparable && rawEffect === 0
      ? 0
      : null;
  const strength: MarkerImpact["strength"] = !outcomeComparable
    ? "unavailable"
    : effectSize == null
      ? Math.abs(rawEffect) > 1e-12 ? "large" : "negligible"
      : Math.abs(effectSize) >= 0.8 ? "large"
        : Math.abs(effectSize) >= 0.5 ? "moderate"
          : Math.abs(effectSize) >= 0.2 ? "small" : "negligible";
  const outcomeEvidencePresent = beforeEvidence.outcome.n > 0 && afterEvidence.outcome.n > 0;
  const outcomeProvenanceMixed = beforeEvidence.outcome.provenance === "mixed"
    || afterEvidence.outcome.provenance === "mixed"
    || beforeEvidence.outcome.provenance !== afterEvidence.outcome.provenance;
  const comparability: MarkerImpact["comparability"] = !adoptionComparable
    ? marker.observedIn === "child" ? "child-only" : "unavailable"
    : !windowComparable || !outcomeEvidencePresent
      ? "unavailable"
      : outcomeProvenanceMixed
        ? "mixed-provenance"
        : lowConfidence ? "thin" : "comparable";
  return {
    marker,
    nBefore: before.length,
    nAfter: after.length,
    judgedBefore: beforeSummary.judgedCount,
    judgedAfter: afterSummary.judgedCount,
    signalBefore: beforeSummary.signalCount,
    signalAfter: afterSummary.signalCount,
    outcomeNBefore: beforeSummary.outcomeSampleSize,
    outcomeNAfter: afterSummary.outcomeSampleSize,
    outcomePoolBefore: poolBefore,
    outcomePoolAfter: poolAfter,
    outcomeComparable,
    windowComparable,
    adoptionComparable,
    beforeEvidence,
    afterEvidence,
    metricComparable,
    effectSize,
    effectSizeKind: effectSize == null ? null : "standardized-mean-difference",
    strength,
    comparability,
    before: a,
    after: b,
    deltas,
    confounds,
    lowConfidence,
  };
}
