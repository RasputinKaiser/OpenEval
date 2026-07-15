import { collectSourceSessions, type LiveSession } from "../live";
import { allCollectionSources, defToSpec } from "../collection/sources";
import { loadCurrentJudgments } from "./judge";
import {
  toPoints, detectMarkers, metricSeries, markerImpact,
  type Marker, type MarkerImpact, type SeriesPoint, type SessionPoint,
} from "./timeline";
import { detectChangePoints, type ChangePoint } from "./changepoints";

export interface TimelineReport {
  totalSessions: number;
  signalCoverage: number; // fraction of sessions with any outcome signal
  judgedCoverage: number; // fraction of sessions with an LLM-judged outcome
  dateStart: number | null;
  dateEnd: number | null;
  overall: {
    firstHalfOutcome: number;
    secondHalfOutcome: number;
    trend: number; // secondHalf - firstHalf
  };
  markers: Marker[];
  impacts: MarkerImpact[];
  changePoints: ChangePoint[]; // automatic shifts, marker-attributed where possible
  outcomeSeries: SeriesPoint[]; // downsampled for a sparkline
}

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  return out;
}

/**
 * Full-history points + markers with persisted judge verdicts blended in.
 * Shared by the report builder and the judging pass (which needs the same
 * points to pick its sample).
 */
export function collectAllPoints(limitPerSource = 100_000): { points: SessionPoint[]; markers: Marker[] } {
  const sessions: Array<LiveSession & { sourceLabel: string }> = [];
  for (const def of allCollectionSources()) {
    if (!def.parseable) continue;
    for (const s of collectSourceSessions(defToSpec(def), limitPerSource, { includeArchived: true })) {
      sessions.push({ ...s, sourceLabel: def.label });
    }
  }
  const points = toPoints(sessions, loadCurrentJudgments());
  return { points, markers: detectMarkers(points) };
}

/**
 * Scan every parseable source (uncapped — the whole history) and assemble the
 * longitudinal report: adoption markers, per-marker before/after impact, and an
 * overall outcome trend. Heavy on a cold cache; the per-file session cache makes
 * repeat calls cheap.
 */
export function buildTimeline(limitPerSource = 100_000): TimelineReport {
  const { points, markers } = collectAllPoints(limitPerSource);

  const withSignal = points.filter((p) => p.outcomeHasSignal);
  const half = Math.floor(withSignal.length / 2);
  const med = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const firstHalfOutcome = med(withSignal.slice(0, half).map((p) => p.outcome));
  const secondHalfOutcome = med(withSignal.slice(half).map((p) => p.outcome));

  // Impact for adopted skills/plugins/subagents (a model marker's "impact" is
  // trivially confounded by being the model), with enough usage and surrounding
  // history to say anything; sort by outcome improvement, most positive first.
  const impacts = markers
    .filter((m) => m.kind !== "model" && m.sessionCount >= 3)
    .map((m) => markerImpact(points, m, 20, 5))
    .filter((im) => im.nBefore + im.nAfter >= 6)
    .sort((a, b) => b.deltas.outcome - a.deltas.outcome);

  return {
    totalSessions: points.length,
    signalCoverage: points.length ? withSignal.length / points.length : 0,
    judgedCoverage: points.length ? points.filter((p) => p.outcomeProvenance === "judged").length / points.length : 0,
    dateStart: points[0]?.at ?? null,
    dateEnd: points[points.length - 1]?.at ?? null,
    overall: { firstHalfOutcome, secondHalfOutcome, trend: secondHalfOutcome - firstHalfOutcome },
    markers,
    impacts,
    changePoints: detectChangePoints(points, markers),
    outcomeSeries: downsample(metricSeries(withSignal, (p) => p.outcome, 15), 80),
  };
}
