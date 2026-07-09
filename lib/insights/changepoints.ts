import type { SessionPoint, Marker } from "./timeline";

/**
 * Automatic change-point detection: find moments where a metric's level
 * SHIFTED, whether or not any known adoption marker explains it. Complements
 * the marker-driven impact table — markers answer "did adopting X help?",
 * change points answer "something changed around June 20; what was it?".
 *
 * Method: sliding two-window mean comparison (Welch-style z score) over the
 * time-ordered series, keeping local maxima above a threshold and at least a
 * window apart. Deliberately simple and inspectable — not PELT — because the
 * series are short (hundreds of points) and the output must be explainable.
 */

export type ChangeMetric = "outcome" | "toolErrorRate" | "costUsd";

export interface ChangePoint {
  at: number; // session timestamp where the shift begins
  metric: ChangeMetric;
  before: number; // mean of the window before
  after: number; // mean of the window after
  delta: number;
  zScore: number;
  /** Marker(s) first seen within the attribution window around the shift, if any. */
  nearMarkers: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs: number[], m: number) => (xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0);

function zAt(values: number[], i: number, window: number): { z: number; before: number; after: number } {
  const a = values.slice(Math.max(0, i - window), i);
  const b = values.slice(i, i + window);
  const ma = mean(a), mb = mean(b);
  const se = Math.sqrt(variance(a, ma) / a.length + variance(b, mb) / b.length);
  return { z: se > 1e-9 ? Math.abs(mb - ma) / se : 0, before: ma, after: mb };
}

export function detectChangePoints(
  points: SessionPoint[],
  markers: Marker[],
  opts: { window?: number; zThreshold?: number; attributionDays?: number } = {},
): ChangePoint[] {
  const window = opts.window ?? 25;
  const zThreshold = opts.zThreshold ?? 3;
  const attributionMs = (opts.attributionDays ?? 7) * 86_400_000;

  const out: ChangePoint[] = [];
  const series: Array<{ metric: ChangeMetric; pts: SessionPoint[]; pick: (p: SessionPoint) => number }> = [
    { metric: "outcome", pts: points.filter((p) => p.outcomeHasSignal), pick: (p) => p.outcome },
    { metric: "toolErrorRate", pts: points, pick: (p) => p.toolErrorRate },
    { metric: "costUsd", pts: points, pick: (p) => p.costUsd },
  ];

  for (const { metric, pts, pick } of series) {
    if (pts.length < window * 2) continue;
    const values = pts.map(pick);
    // Score every eligible split, then keep local maxima above threshold,
    // enforcing a minimum gap of one window between accepted shifts.
    const scores: Array<{ i: number; z: number; before: number; after: number }> = [];
    for (let i = window; i <= pts.length - window; i++) {
      const { z, before, after } = zAt(values, i, window);
      scores.push({ i, z, before, after });
    }
    scores.sort((a, b) => b.z - a.z);
    const taken: number[] = [];
    for (const s of scores) {
      if (s.z < zThreshold) break;
      if (taken.some((t) => Math.abs(t - s.i) < window)) continue;
      taken.push(s.i);
      const at = pts[s.i].at;
      out.push({
        at,
        metric,
        before: s.before,
        after: s.after,
        delta: s.after - s.before,
        zScore: s.z,
        // All marker kinds qualify as suspects — model switches especially.
        nearMarkers: markers
          .filter((m) => Math.abs(m.firstSeenAt - at) <= attributionMs)
          .sort((a, b) => Math.abs(a.firstSeenAt - at) - Math.abs(b.firstSeenAt - at))
          .slice(0, 3)
          .map((m) => `${m.kind}: ${m.name}`),
      });
    }
  }

  return out.sort((a, b) => b.zScore - a.zScore).slice(0, 12);
}
