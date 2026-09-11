import { collectSourceSessions, type LiveSession } from "../live";
import { allCollectionSources, defToSpec } from "../collection/sources";
import { JUDGE_PROMPT_VERSION, loadCurrentJudgments } from "./judge";
import { loadJudgments } from "../live-cache";
import {
  toPoints, detectMarkers, metricSeries, markerImpact,
  type Marker, type MarkerImpact, type SeriesPoint, type SessionPoint, type OutcomeProvenance, type OutcomeSeriesEvidence,
} from "./timeline";
import { detectChangePoints, type ChangePoint } from "./changepoints";

export interface JudgeSelectionDistribution {
  source: string;
  model: string;
  reasoningEffort: string | null;
  promptVersion: number | null;
  count: number;
}

export interface JudgeComparability {
  homogeneous: boolean;
  mixed: boolean;
  warning: string | null;
  /** Current-prompt rows that are eligible for the comparable score view. */
  denominator: number;
  /** All judgment receipts matched to the current top-level session population. */
  receiptDenominator: number;
  /** Matched receipts produced under a prompt contract other than the current one. */
  staleReceiptCount: number;
}

export interface TimelineReport {
  totalSessions: number;
  /** Child-agent traces retained in Collection but excluded from outcome denominators. */
  excludedSubagentSessions?: number;
  signalSessions: number;
  judgedSessions: number;
  heuristicSignalSessions: number;
  noSignalSessions: number;
  signalCoverage: number; // fraction of sessions with any outcome signal
  judgedCoverage: number; // fraction of sessions with an LLM-judged outcome
  dateStart: number | null;
  dateEnd: number | null;
  overall: {
    firstHalfOutcome: number;
    secondHalfOutcome: number;
    trend: number; // secondHalf - firstHalf
    /** Signal-session denominators used by the two half medians. */
    firstHalfN?: number;
    secondHalfN?: number;
    /** False when either half has no signal sessions to compare. */
    comparable?: boolean;
    /** Homogeneous outcome instrument selected for the displayed halves. */
    outcomeProvenance?: OutcomeProvenance | "mixed";
  };
  markers: Marker[];
  impacts: MarkerImpact[];
  changePoints: ChangePoint[]; // automatic shifts, marker-attributed where possible
  outcomeSeries: SeriesPoint[]; // downsampled for a sparkline
  /** Per-session cost-vs-outcome scatter (signal sessions only; no identifiers). */
  outcomeScatter: { c: number; o: number; p: OutcomeProvenance }[];
  outcomeScatterEvidence: { n: number; denominator: number; coverage: number };
  /** Exact source denominator and provenance for the downsampled outcome chart. */
  outcomeSeriesEvidence?: OutcomeSeriesEvidence;
  judgeSelectionDistribution?: JudgeSelectionDistribution[];
  judgeComparability?: JudgeComparability;
}

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  return out;
}

/** Session shape the timeline needs: a parsed session tagged with its source. */
export type TimelineSession = LiveSession & { sourceLabel: string };

const isChildSession = (session: TimelineSession): boolean => Boolean(session.isSubagent || session.parentSessionId);

function mergeMarkerEvidence(topLevel: Marker[], child: Marker[]): Marker[] {
  const merged = new Map<string, Marker>();
  for (const marker of topLevel) {
    merged.set(`${marker.kind}\u0000${marker.name}`, {
      ...marker,
      observedIn: "top-level",
      sessionCount: marker.topLevelSessionCount ?? marker.sessionCount,
      evidenceSessionCount: marker.topLevelSessionCount ?? marker.sessionCount,
      childSessionCount: 0,
      topLevelSessionCount: marker.topLevelSessionCount ?? marker.sessionCount,
      topLevelFirstSeenAt: marker.topLevelFirstSeenAt ?? marker.firstSeenAt,
    });
  }
  for (const marker of child) {
    const key = `${marker.kind}\u0000${marker.name}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...marker,
        observedIn: "child",
        // A child-only marker has no top-level denominator. Keep its retained
        // trace count separately so judge/impact sampling cannot use it.
        sessionCount: 0,
        evidenceSessionCount: marker.childSessionCount ?? marker.evidenceSessionCount ?? marker.sessionCount,
        childSessionCount: marker.childSessionCount ?? marker.evidenceSessionCount ?? marker.sessionCount,
        topLevelSessionCount: 0,
        childFirstSeenAt: marker.childFirstSeenAt ?? marker.firstSeenAt,
      });
      continue;
    }
    const childCount = marker.childSessionCount ?? marker.evidenceSessionCount ?? marker.sessionCount;
    existing.evidenceSessionCount = (existing.evidenceSessionCount ?? existing.sessionCount) + childCount;
    existing.childSessionCount = (existing.childSessionCount ?? 0) + childCount;
    existing.childFirstSeenAt = existing.childFirstSeenAt == null
      ? marker.childFirstSeenAt ?? marker.firstSeenAt
      : Math.min(existing.childFirstSeenAt, marker.childFirstSeenAt ?? marker.firstSeenAt);
    // `firstSeenAt` is the adoption boundary for top-level outcomes. Child
    // evidence must never move it earlier and create a false before/after split.
    existing.observedIn = "both";
  }
  return [...merged.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
}

/**
 * Full-history points + markers with persisted judge verdicts blended in.
 * Shared by the report builder and the judging pass (which needs the same
 * points to pick its sample). Pass `sessionsIn` (e.g. from
 * `collectAllSessions()`) to reuse an already-parsed collection; judgments
 * are still loaded fresh on every call.
 */
export function collectAllPoints(sessionsIn?: TimelineSession[], limitPerSource = 100_000): { points: SessionPoint[]; markers: Marker[]; excludedSubagentSessions: number } {
  let sessions = sessionsIn;
  if (!sessions) {
    sessions = [];
    for (const def of allCollectionSources()) {
      if (!def.parseable) continue;
      for (const s of collectSourceSessions(defToSpec(def), limitPerSource, { includeArchived: true })) {
        sessions.push({ ...s, sourceLabel: def.label });
      }
    }
  }
  const topLevelSessions = sessions.filter((session) => !isChildSession(session));
  const points = toPoints(topLevelSessions, loadCurrentJudgments());
  // Outcomes use top-level sessions only, but child traces still carry real
  // adoption evidence (a skill/model may first appear inside delegated work).
  // Build markers from the complete corpus so collecting child traces does not
  // make those adoptions disappear from the Timeline.
  const topLevelMarkers = detectMarkers(points);
  const childMarkers = topLevelSessions.length === sessions.length
    ? []
    : detectMarkers(toPoints(sessions.filter(isChildSession)), "child");
  return {
    points,
    markers: mergeMarkerEvidence(topLevelMarkers, childMarkers),
    excludedSubagentSessions: sessions.length - topLevelSessions.length,
  };
}

/**
 * Scan every parseable source (uncapped — the whole history) and assemble the
 * longitudinal report: adoption markers, per-marker before/after impact, and an
 * overall outcome trend. Heavy on a cold cache; the per-file session cache makes
 * repeat calls cheap.
 */
export function buildTimeline(sessionsIn?: TimelineSession[]): TimelineReport {
  const { points, markers, excludedSubagentSessions } = collectAllPoints(sessionsIn);

  const withSignal = points.filter((p) => p.outcomeHasSignal);
  const MIN_OVERALL_SAMPLES = 5;
  const med = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const halves = (series: SessionPoint[]) => {
    const half = Math.floor(series.length / 2);
    return { first: series.slice(0, half), second: series.slice(half) };
  };
  const judged = withSignal.filter((p) => p.outcomeProvenance === "judged");
  const heuristic = withSignal.filter((p) => p.outcomeProvenance === "heuristic");
  const judgedHalves = halves(judged);
  const heuristicHalves = halves(heuristic);
  const fallbackProvenance: OutcomeProvenance | "mixed" = judged.length && heuristic.length
    ? "mixed"
    : judged.length
      ? "judged"
      : heuristic.length
        ? "heuristic"
        : "unavailable";
  const hasJudgedSeries = judgedHalves.first.length >= MIN_OVERALL_SAMPLES && judgedHalves.second.length >= MIN_OVERALL_SAMPLES;
  const selected = hasJudgedSeries
    ? { ...judgedHalves, provenance: "judged" as const }
    : heuristicHalves.first.length >= MIN_OVERALL_SAMPLES && heuristicHalves.second.length >= MIN_OVERALL_SAMPLES
      ? { ...heuristicHalves, provenance: "heuristic" as const }
      : { ...halves(withSignal), provenance: fallbackProvenance };
  const firstHalf = selected.first;
  const secondHalf = selected.second;
  const seriesPoints = [...firstHalf, ...secondHalf];
  const seriesPool: OutcomeSeriesEvidence["pool"] = hasJudgedSeries ? "judged" : "signal";
  const firstHalfOutcome = med(firstHalf.map((p) => p.outcome));
  const secondHalfOutcome = med(secondHalf.map((p) => p.outcome));
  const overallComparable = firstHalf.length >= MIN_OVERALL_SAMPLES
    && secondHalf.length >= MIN_OVERALL_SAMPLES
    && selected.provenance !== "mixed"
    && selected.provenance !== "unavailable";

  // Impact for adopted skills/plugins/subagents (a model marker's "impact" is
  // trivially confounded by being the model), with enough usage and surrounding
  // history to say anything; sort by outcome improvement, most positive first.
  const impacts = markers
    .filter((m) => m.kind !== "model" && m.observedIn !== "child" && m.sessionCount >= 3)
    .map((m) => markerImpact(points, m, 20, 5))
    .filter((im) => im.nBefore + im.nAfter >= 6)
    .sort((a, b) => {
      if (a.outcomeComparable !== b.outcomeComparable) return a.outcomeComparable ? -1 : 1;
      return b.deltas.outcome - a.deltas.outcome;
    });

  const judgedSessions = points.filter((p) => p.outcomeProvenance === "judged").length;
  const heuristicSignalSessions = withSignal.length - judgedSessions;
  const noSignalSessions = points.length - withSignal.length;

  // Score points deliberately use current-prompt judgments above. The receipt
  // view is broader: retain every persisted judgment that matches a current
  // top-level session, including stale/legacy prompt versions, without letting
  // those rows replace the comparable score.
  const persistedJudgments = loadJudgments();
  const receipts = points
    .map((point) => point.path ? persistedJudgments.get(point.path) : undefined)
    .filter((judgment): judgment is NonNullable<typeof judgment> => Boolean(judgment));
  const distribution = new Map<string, JudgeSelectionDistribution>();
  for (const judgment of receipts) {
    const selection = judgment.selection;
    const source = selection?.source ?? "unknown";
    const model = selection?.model ?? "unknown";
    const reasoningEffort = selection?.reasoningEffort ?? null;
    const promptVersion = judgment.promptVersion ?? null;
    const key = `${source}\u0000${model}\u0000${reasoningEffort ?? ""}\u0000${promptVersion ?? ""}`;
    const current = distribution.get(key);
    if (current) current.count++;
    else distribution.set(key, { source, model, reasoningEffort, promptVersion, count: 1 });
  }
  const judgeSelectionDistribution = [...distribution.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  const mixed = judgeSelectionDistribution.length > 1;
  const staleReceiptCount = receipts.filter((judgment) => judgment.promptVersion !== JUDGE_PROMPT_VERSION).length;
  const judgeComparability: JudgeComparability = {
    homogeneous: judgeSelectionDistribution.length <= 1,
    mixed,
    denominator: judgedSessions,
    receiptDenominator: receipts.length,
    staleReceiptCount,
    warning: mixed
      ? "This judged population mixes backend, model, or prompt-version receipts; do not collapse it into one comparable denominator."
      : null,
  };

  return {
    totalSessions: points.length,
    excludedSubagentSessions,
    signalSessions: withSignal.length,
    judgedSessions,
    heuristicSignalSessions,
    noSignalSessions,
    signalCoverage: points.length ? withSignal.length / points.length : 0,
    judgedCoverage: points.length ? judgedSessions / points.length : 0,
    dateStart: points[0]?.at ?? null,
    dateEnd: points[points.length - 1]?.at ?? null,
    overall: {
      firstHalfOutcome,
      secondHalfOutcome,
      trend: overallComparable ? secondHalfOutcome - firstHalfOutcome : 0,
      firstHalfN: firstHalf.length,
      secondHalfN: secondHalf.length,
      comparable: overallComparable,
      outcomeProvenance: selected.provenance,
    },
    markers,
    impacts,
    changePoints: detectChangePoints(points, markers),
    outcomeSeries: downsample(metricSeries(seriesPoints, (p) => p.outcome, 15), 80),
    outcomeScatter: withSignal
      .filter((p) => p.costAvailable !== false && Number.isFinite(p.costUsd) && p.costUsd > 0 && Number.isFinite(p.outcome))
      .slice(0, 400)
      .map((p) => ({ c: Math.round(p.costUsd * 1000) / 1000, o: Math.round(p.outcome * 100) / 100, p: p.outcomeProvenance })),
    outcomeScatterEvidence: {
      n: withSignal.filter((p) => p.costAvailable !== false && Number.isFinite(p.costUsd) && p.costUsd > 0 && Number.isFinite(p.outcome)).length,
      denominator: points.length,
      coverage: points.length ? withSignal.filter((p) => p.costAvailable !== false && Number.isFinite(p.costUsd) && p.costUsd > 0).length / points.length : 0,
    },
    outcomeSeriesEvidence: {
      n: seriesPoints.length,
      denominator: points.length,
      coverage: points.length ? seriesPoints.length / points.length : 0,
      pool: seriesPool,
      provenance: selected.provenance,
    },
    judgeSelectionDistribution,
    judgeComparability,
  };
}
