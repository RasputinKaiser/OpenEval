import type {
  EvidenceProvenance,
  Marker,
  SessionPoint,
} from "./timeline";

/**
 * Automatic change-point detection: find moments where a metric's level
 * shifted, whether or not any known adoption marker explains it. A nearby
 * marker is reported as temporal correlation only; it is never treated as a
 * causal explanation.
 */

export type ChangeMetric = "outcome" | "toolErrorRate" | "costUsd";

export interface ChangePoint {
  at: number; // session timestamp where the shift begins
  metric: ChangeMetric;
  before: number; // mean of the window before
  after: number; // mean of the window after
  delta: number;
  /** Finite observations used on each side of this detected shift. */
  sampleBefore: number;
  sampleAfter: number;
  zScore: number;
  /** Standardized mean difference; null when both sides are constant but differ. */
  effectSize: number | null;
  strength: "weak" | "moderate" | "strong";
  provenance: EvidenceProvenance;
  comparability: "comparable" | "mixed-provenance";
  /** Global shift remains the default; this means only temporal overlap with adoption. */
  attribution: "global" | "adoption-correlated";
  /** Marker(s) first seen within the attribution window around the shift, if any. */
  nearMarkers: string[];
}

const MAX_Z = 50;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs: number[], m: number) => (xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0);

function zAt(values: number[], i: number, window: number): {
  z: number;
  before: number;
  after: number;
  effectSize: number | null;
} {
  const a = values.slice(i - window, i);
  const b = values.slice(i, i + window);
  const ma = mean(a), mb = mean(b);
  const va = variance(a, ma), vb = variance(b, mb);
  const se = Math.sqrt(va / a.length + vb / b.length);
  const difference = Math.abs(mb - ma);
  // A genuine constant step has zero estimated standard error. Report a
  // finite capped strength instead of Infinity/NaN in a JSON/UI contract.
  const z = se > 1e-9 ? Math.min(MAX_Z, difference / se) : difference > 1e-12 ? MAX_Z : 0;
  const pooled = a.length + b.length > 2
    ? ((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2)
    : 0;
  const effectSize = pooled > 1e-12
    ? (mb - ma) / Math.sqrt(pooled)
    : difference <= 1e-12 ? 0 : null;
  return { z, before: ma, after: mb, effectSize };
}

function strength(z: number, effectSize: number | null, delta: number): ChangePoint["strength"] {
  if (effectSize == null) return Math.abs(delta) > 1e-12 ? "strong" : "weak";
  const magnitude = Math.max(Math.abs(effectSize), z >= 10 ? 0.8 : z >= 5 ? 0.5 : 0);
  return magnitude >= 0.8 ? "strong" : magnitude >= 0.5 ? "moderate" : "weak";
}

function pointCostAvailable(point: SessionPoint): boolean {
  if (point.costAvailable !== undefined) return point.costAvailable && Number.isFinite(point.costUsd);
  if (point.costSource === "measured") return Number.isFinite(point.costUsd) && point.costUsd >= 0;
  if (point.costSource === "inferred") return Number.isFinite(point.costUsd) && point.costUsd > 0;
  return point.costSource === undefined && Number.isFinite(point.costUsd);
}

function provenanceFor(points: SessionPoint[], metric: ChangeMetric): EvidenceProvenance {
  if (points.length === 0) return "unavailable";
  if (metric === "outcome") {
    const judged = points.filter((p) => p.outcomeProvenance === "judged").length;
    const heuristic = points.filter((p) => p.outcomeProvenance === "heuristic").length;
    return judged > 0 && heuristic > 0 ? "mixed" : judged > 0 ? "judged" : "heuristic";
  }
  if (metric === "costUsd") {
    const measured = points.filter((p) => p.costSource === "measured").length;
    const inferred = points.length - measured;
    return measured > 0 && inferred > 0 ? "mixed" : measured > 0 ? "measured" : "inferred";
  }
  return "observed";
}

function outcomeSeries(points: SessionPoint[], window: number): { points: SessionPoint[]; provenance: EvidenceProvenance } {
  const signal = points.filter((p) => p.outcomeHasSignal && Number.isFinite(p.outcome));
  const judged = signal.filter((p) => p.outcomeProvenance === "judged");
  const heuristic = signal.filter((p) => p.outcomeProvenance === "heuristic");
  // Never let a judge/heuristic instrument transition become an apparent
  // outcome shift. Prefer judged only when it fills both detection windows;
  // otherwise use a homogeneous heuristic series if it is large enough.
  if (judged.length >= window * 2) return { points: judged, provenance: "judged" };
  if (heuristic.length >= window * 2) return { points: heuristic, provenance: "heuristic" };
  return { points: [], provenance: "unavailable" };
}

function markerNamesNear(markers: Marker[], at: number, attributionMs: number): string[] {
  return markers
    .filter((m) => m.observedIn !== "child" && Number.isFinite(m.firstSeenAt))
    .map((m) => ({ marker: m, distance: Math.abs(m.firstSeenAt - at) }))
    .filter(({ distance }) => distance <= attributionMs)
    .sort((a, b) => a.distance - b.distance
      || a.marker.kind.localeCompare(b.marker.kind)
      || a.marker.name.localeCompare(b.marker.name))
    .slice(0, 3)
    .map(({ marker }) => `${marker.kind}: ${marker.name}`);
}

export function detectChangePoints(
  points: SessionPoint[],
  markers: Marker[],
  opts: { window?: number; zThreshold?: number; attributionDays?: number; minSamplesPerSide?: number } = {},
): ChangePoint[] {
  const window = opts.window ?? 25;
  const minSamples = opts.minSamplesPerSide ?? 5;
  if (!Number.isInteger(window) || window < 1 || !Number.isInteger(minSamples) || minSamples < 1 || window < minSamples) return [];
  const zThreshold = Number.isFinite(opts.zThreshold) && (opts.zThreshold ?? 0) >= 0 ? opts.zThreshold! : 3;
  const attributionDays = Number.isFinite(opts.attributionDays) && (opts.attributionDays ?? 0) >= 0 ? opts.attributionDays! : 7;
  const attributionMs = attributionDays * 86_400_000;

  const outcome = outcomeSeries(points, window);
  const series: Array<{
    metric: ChangeMetric;
    pts: SessionPoint[];
    pick: (p: SessionPoint) => number;
    provenance: EvidenceProvenance;
  }> = [
    ...(outcome.points.length ? [{ metric: "outcome" as const, pts: outcome.points, pick: (p: SessionPoint) => p.outcome, provenance: outcome.provenance }] : []),
    {
      metric: "toolErrorRate",
      pts: points.filter((p) => Number.isFinite(p.toolErrorRate)),
      pick: (p) => p.toolErrorRate,
      provenance: "observed",
    },
    {
      metric: "costUsd",
      pts: points.filter(pointCostAvailable),
      pick: (p) => p.costUsd,
      provenance: provenanceFor(points.filter(pointCostAvailable), "costUsd"),
    },
  ];

  const out: ChangePoint[] = [];
  for (const { metric, pts, pick, provenance } of series) {
    if (pts.length < window * 2 || pts.length < minSamples * 2) continue;
    const values = pts.map(pick).filter(Number.isFinite);
    if (values.length !== pts.length) continue;
    const scores: Array<{ i: number; z: number; before: number; after: number; effectSize: number | null }> = [];
    for (let i = window; i <= pts.length - window; i++) {
      const score = zAt(values, i, window);
      scores.push({ i, ...score });
    }
    scores.sort((a, b) => b.z - a.z || a.i - b.i);
    const taken: number[] = [];
    for (const s of scores) {
      if (s.z < zThreshold) break;
      if (taken.some((t) => Math.abs(t - s.i) < window)) continue;
      taken.push(s.i);
      const at = pts[s.i].at;
      const nearMarkers = markerNamesNear(markers, at, attributionMs);
      const sideProvenance = metric === "costUsd"
        ? [provenanceFor(pts.slice(s.i - window, s.i), metric), provenanceFor(pts.slice(s.i, s.i + window), metric)]
        : [provenance, provenance];
      const localProvenance: EvidenceProvenance = sideProvenance[0] === sideProvenance[1]
        ? sideProvenance[0]
        : "mixed";
      out.push({
        at,
        metric,
        before: s.before,
        after: s.after,
        delta: s.after - s.before,
        sampleBefore: window,
        sampleAfter: window,
        zScore: s.z,
        effectSize: s.effectSize,
        strength: strength(s.z, s.effectSize, s.after - s.before),
        provenance: localProvenance,
        comparability: sideProvenance[0] === sideProvenance[1] && sideProvenance[0] !== "mixed" ? "comparable" : "mixed-provenance",
        attribution: nearMarkers.length ? "adoption-correlated" : "global",
        nearMarkers,
      });
    }
  }

  return out
    .sort((a, b) => b.zScore - a.zScore || a.metric.localeCompare(b.metric) || a.at - b.at)
    .slice(0, 12);
}
