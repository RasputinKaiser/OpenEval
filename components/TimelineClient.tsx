"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Activity, TrendingUp, TrendingDown, AlertTriangle, ArrowLeft, Gavel, Scale, GitCompareArrows, Zap, CalendarPlus, Filter, CheckCircle2, Loader2, RefreshCw, Info, ChevronDown, ScatterChart } from "lucide-react";
import PageHeader from "./PageHeader";
import { DivergingDeltaChart } from "./DivergingDeltaChart";
import { KIND_COLOR, KIND_ICON, KIND_LABEL } from "./markerKinds";
import { SectionHeader } from "./Section";
import { ProgressiveSectionNav, sectionVisibilityClass, useProgressiveSection } from "./mobile/ProgressiveSectionNav";
import OutcomeChart from "./OutcomeChart";
import { fmtDate, fmtInt, fmtPct as pct, fmtSigned as signed } from "@/lib/format";
import { CostVsOutcome } from "./CostVsOutcome";
import type { TimelineReport } from "@/lib/insights/collect";
import type { MarkerKind, OutcomeSeriesEvidence } from "@/lib/insights/timeline";
import type { JudgeJobStatus } from "@/lib/insights/judge";
import { shouldPollJudgeStatus, timelinePollError, timelineRefreshPhase } from "@/lib/timeline-poll-state";
import { EvidenceComposition } from "./evidence/EvidenceComposition";
import { EvidenceReview } from "./evidence/EvidenceReview";
import JudgePicker from "./JudgePicker";
import type { JudgeSelectionInput } from "@/lib/grader/selection";


const MARKER_KINDS: MarkerKind[] = ["skill", "mcp", "subagent", "model"];
type KindFilter = MarkerKind | "all";
const TIMELINE_IMPACT_WINDOW = 20;
const TIMELINE_MARKER_WINDOW = 30;

const isMarkerKind = (v: string | null): v is MarkerKind => MARKER_KINDS.includes(v as MarkerKind);

/**
 * Sticky first column for the wide impact table — row identity stays visible
 * while the delta columns scroll on narrow screens.
 */
const STICKY_TH = "sticky left-0 z-[2] border-r border-bd-subtle";
const STICKY_TD = "sticky left-0 z-[1] border-r border-bd-subtle bg-bg-subtle";

/** A colored delta chip. `lowerIsBetter` flips the good/bad coloring. */
function Delta({ value, lowerIsBetter, fmt }: { value: number; lowerIsBetter?: boolean; fmt: (v: number) => string }) {
  const good = lowerIsBetter ? value < 0 : value > 0;
  const bad = lowerIsBetter ? value > 0 : value < 0;
  const tone = Math.abs(value) < 1e-9 ? "text-fg-dim" : good ? "text-ok" : bad ? "text-err" : "text-fg-dim";
  return <span className={clsx("mono tabular-nums", tone)}>{fmt(value)}</span>;
}

/** Diverging mini-bar from a center axis — makes the impact ranking scannable. */
function DeltaBar({ value, max }: { value: number; max: number }) {
  const frac = max > 1e-9 ? Math.min(1, Math.abs(value) / max) : 0;
  const good = value > 1e-9;
  const bad = value < -1e-9;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="relative h-[5px] w-14 rounded-full bg-bg-elev overflow-hidden shrink-0" aria-hidden>
        <div className="absolute inset-y-0 left-1/2 w-px bg-bd" />
        {(good || bad) && (
          <div
            className="absolute inset-y-0 rounded-full"
            style={{
              left: good ? "50%" : `${50 - frac * 50}%`,
              width: `${Math.max(3, frac * 50)}%`,
              background: good ? "var(--color-ok)" : "var(--color-err)",
              opacity: 0.8,
            }}
          />
        )}
      </div>
      <Delta value={value} fmt={(v) => signed(v)} />
    </div>
  );
}

type TimelinePayload = TimelineReport & {
  generatedAtMs?: number;
  stale?: boolean;
  refreshing?: boolean;
  refreshError?: string;
};

export default function TimelineClient({ data: initialData, error }: { data: TimelinePayload; error?: string }) {
  const [data, setData] = useState(initialData);
  const [judging, setJudging] = useState(false);
  const [judgeMsg, setJudgeMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [job, setJob] = useState<JudgeJobStatus | null>(null);
  const [timelineLoaded, setTimelineLoaded] = useState(!error);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineStale, setTimelineStale] = useState(Boolean(error || initialData.stale || initialData.refreshing || initialData.refreshError));
  const [timelineError, setTimelineError] = useState<string | null>(error ?? initialData.refreshError ?? null);
  const [jobStatusError, setJobStatusError] = useState<string | null>(null);
  const [judgeSelection, setJudgeSelection] = useState<JudgeSelectionInput>({ source: "codex", model: "gpt-5.6-luna", reasoningEffort: "high" });
  const [judgeReadiness, setJudgeReadiness] = useState<{ readiness: string; detail: string }>({ readiness: "unknown", detail: "Checking judge readiness…" });
  const handleJudgeReadiness = useCallback((next: { readiness: string; detail: string }) => setJudgeReadiness(next), []);
  const [timelineUpdatedAt, setTimelineUpdatedAt] = useState<number | null>(initialData.generatedAtMs ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const judgePopoverRef = useRef<HTMLDetailsElement | null>(null);
  // Click-away dismissal for the judge popover: plain <details> has no outside-click
  // semantics, so a stray click left it hanging over the content. Dismiss on any pointer
  // down outside the element (and its trigger, which lives inside it).
  useEffect(() => {
    const el = judgePopoverRef.current;
    if (!el) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (el.open && !el.contains(target)) el.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const pollInFlightRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  // Marker-kind filter, mirrored into `?kind=` so a filtered view survives
  // reload/share. Read on mount (not in the initializer) to keep SSR and the
  // first client render identical.
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [impactVisibleCount, setImpactVisibleCount] = useState(TIMELINE_IMPACT_WINDOW);
  const [markerVisibleCount, setMarkerVisibleCount] = useState(TIMELINE_MARKER_WINDOW);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("kind");
    if (isMarkerKind(fromUrl)) setKindFilter(fromUrl);
  }, []);

  const applyKindFilter = useCallback((kind: KindFilter) => {
    setKindFilter(kind);
    const url = new URL(window.location.href);
    if (kind === "all") url.searchParams.delete("kind");
    else url.searchParams.set("kind", kind);
    window.history.replaceState(null, "", url);
  }, []);

  const visibleMarkers = useMemo(
    () => (kindFilter === "all" ? data.markers : data.markers.filter((m) => m.kind === kindFilter)),
    [data.markers, kindFilter],
  );
  const visibleImpacts = useMemo(
    () => (kindFilter === "all" ? data.impacts : data.impacts.filter((im) => im.marker.kind === kindFilter)),
    [data.impacts, kindFilter],
  );
  const renderedImpacts = useMemo(
    () => visibleImpacts.slice(0, impactVisibleCount),
    [visibleImpacts, impactVisibleCount],
  );
  const newestVisibleMarkers = useMemo(
    () => [...visibleMarkers].reverse(),
    [visibleMarkers],
  );
  const renderedMarkers = useMemo(
    () => newestVisibleMarkers.slice(0, markerVisibleCount),
    [newestVisibleMarkers, markerVisibleCount],
  );
  const markerCounts = useMemo(
    () => MARKER_KINDS.reduce<Record<MarkerKind, number>>((counts, kind) => {
      counts[kind] = data.markers.filter((marker) => marker.kind === kind).length;
      return counts;
    }, { skill: 0, mcp: 0, subagent: 0, model: 0 }),
    [data.markers],
  );
  const lowConfidenceImpactCount = useMemo(
    () => data.impacts.filter((impact) => impact.lowConfidence).length,
    [data.impacts],
  );

  useEffect(() => {
    setImpactVisibleCount(TIMELINE_IMPACT_WINDOW);
    setMarkerVisibleCount(TIMELINE_MARKER_WINDOW);
  }, [kindFilter]);

  const sections = useMemo(() => [
    { id: "overview", label: "Start here", description: "Check the corpus, signal coverage, and provenance." },
    { id: "outcome", label: "Outcome trend", description: "Read the trend and its limits." },
    { id: "impact", label: "Compare before/after", description: "Compare before/after windows around adoption." },
    ...((data.changePoints ?? []).length > 0 ? [{ id: "shifts", label: "Explain shifts", description: "See population shifts without claiming a cause." }] : []),
    { id: "adoptions", label: "Adoption history", description: "See when skills, plugins, models, and subagents first appeared." },
  ], [data.changePoints]);
  const { activeSection, selectSection, isVisible } = useProgressiveSection(sections, "all");

  const trend = data.overall.trend;
  const firstHalfN = data.overall.firstHalfN ?? Math.floor(data.signalSessions / 2);
  const secondHalfN = data.overall.secondHalfN ?? Math.max(0, data.signalSessions - firstHalfN);
  const trendComparable = data.overall.comparable ?? (firstHalfN > 0 && secondHalfN > 0);
  const TrendIcon = !trendComparable ? Activity : trend >= 0 ? TrendingUp : TrendingDown;

  const refreshData = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const request = (async (): Promise<boolean> => {
      setTimelineLoading(true);
      setTimelineError(null);
      try {
        // The route deliberately permits private browser caching for ordinary
        // navigation. An explicit refresh must bypass that cache or a stale
        // response can be replayed for 30 seconds and keep the UI amber.
        const fresh = await fetch("/api/collection/timeline?fresh=1", { cache: "no-store" });
        if (!fresh.ok) throw new Error(`HTTP ${fresh.status}`);
        const next = (await fresh.json()) as TimelinePayload;
        setData(next);
        setTimelineLoaded(true);
        setTimelineStale(Boolean(next.stale || next.refreshing || next.refreshError));
        setTimelineError(next.refreshError ?? null);
        setTimelineUpdatedAt(next.generatedAtMs ?? Date.now());
        return true;
      } catch (e) {
        setTimelineError(timelinePollError(e));
        setTimelineStale(true);
        return false;
      } finally {
        setTimelineLoading(false);
      }
    })();
    refreshInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
    }
  }, []);

  // A stale-while-revalidate response deliberately returns the last-good
  // report before the collection refresh finishes. Follow it once the shared
  // background refresh has had time to settle so the UI does not remain
  // permanently amber until the user presses Retry a second time.
  useEffect(() => {
    if (!timelineStale || timelineLoading || timelineError) return;
    const timer = window.setTimeout(() => { void refreshData(); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [timelineStale, timelineLoading, timelineError, refreshData]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJudgeStatus = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const res = await fetch("/api/collection/timeline/judge");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s: JudgeJobStatus = await res.json();
      setJob(s);
      setJobStatusError(null);
      if (!shouldPollJudgeStatus(s)) {
        stopPolling();
        await refreshData();
      } else {
        setTimelineStale(true);
      }
    } catch (e) {
      stopPolling();
      setJobStatusError(`Judge status unavailable: ${timelinePollError(e)}`);
      setTimelineStale(true);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [refreshData, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setJobStatusError(null);
    setTimelineStale(true);
    pollRef.current = setInterval(() => { void pollJudgeStatus(); }, 4000);
  }, [pollJudgeStatus, stopPolling]);

  const loadJobStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/collection/timeline/judge");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s: JudgeJobStatus = await res.json();
      setJobStatusError(null);
      if (s.startedAt) setJob(s);
      if (shouldPollJudgeStatus(s)) startPolling();
      else stopPolling();
    } catch (e) {
      stopPolling();
      setJobStatusError(`Judge status unavailable: ${timelinePollError(e)}`);
      setTimelineStale(true);
    }
  }, [startPolling, stopPolling]);

  // A background job may already be running from an earlier visit — pick it up.
  useEffect(() => {
    void loadJobStatus();
    return stopPolling;
  }, [loadJobStatus, stopPolling]);

  const retryTimeline = useCallback(async () => {
    const wasRunning = job?.running === true;
    const refreshed = await refreshData();
    if (wasRunning) startPolling();
    else await loadJobStatus();
    if (refreshed && !wasRunning) setJobStatusError(null);
  }, [job?.running, loadJobStatus, refreshData, startPolling]);

  async function judgeAllWindows() {
    try {
      const res = await fetch("/api/collection/timeline/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, selection: judgeSelection }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      setJob(r.status);
      setJobStatusError(null);
      setTimelineStale(Boolean(r.status.running));
      if (r.started && shouldPollJudgeStatus(r.status)) startPolling();
      else if (!r.status.running) setJudgeMsg("Every marker-window session is already judged.");
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function refineWithJudge() {
    setJudging(true);
    setJudgeMsg(null);
    try {
      const res = await fetch("/api/collection/timeline/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: 10, selection: judgeSelection }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      setJudgeMsg(
        r.judged > 0
          ? `Judged ${r.judged}/${r.sampled} sessions via ${r.judge}${r.failed ? ` (${r.failed} failed)` : ""}.`
          : r.sampled === 0
            ? "Every sampled session is already judged."
            : r.lastError && /usage limit/i.test(r.lastError)
              ? `Judge backend is out of plan budget — ${r.lastError.match(/try again at ([^)]+)\.?$/i)?.[1] ? `resets ${r.lastError.match(/try again at ([^)]+)\.?$/i)![1]}` : "try again later"}. Stale receipts keep their old scores until a pass succeeds.`
              : `No verdicts returned (${r.failed} failed via ${r.judge}).${r.lastError ? ` Last error: ${r.lastError}` : ""}`,
      );
      const refreshed = await refreshData();
      if (refreshed) setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setJudging(false);
    }
  }

  const timelinePhase = timelineRefreshPhase({
    hasData: timelineLoaded,
    loading: timelineLoading,
    stale: timelineStale || shouldPollJudgeStatus(job),
    error: timelineError ?? jobStatusError,
  });
  const timelineStatusError = timelineError ?? jobStatusError;
  const seriesEvidence: OutcomeSeriesEvidence = data.outcomeSeriesEvidence ?? {
    n: data.signalSessions,
    denominator: data.totalSessions,
    coverage: data.signalCoverage,
    // Older payloads do not expose whether the series switched to a judged-only
    // pool, so the compatibility fallback stays conservative and calls it signal.
    pool: "signal",
    provenance: data.signalSessions === 0
      ? "unavailable"
      : data.judgedSessions > 0 && data.heuristicSignalSessions > 0
        ? "mixed"
        : data.judgedSessions > 0
          ? "judged"
          : "heuristic",
  };
  const seriesBasisCopy = seriesEvidence.pool === "judged"
    ? "model-reviewed sessions"
    : seriesEvidence.provenance === "mixed"
      ? "a mix of model-reviewed and rule-based signals"
      : seriesEvidence.provenance === "judged"
        ? "model-reviewed outcome signals"
        : "outcome signals";
  const seriesN = seriesEvidence.n;
  const seriesDenominator = seriesEvidence.denominator;
  const seriesCoverage = seriesEvidence.coverage;
  const retainedJudgeReceiptCount = data.judgeSelectionDistribution?.length
    ? data.judgeSelectionDistribution.reduce((total, group) => total + group.count, 0)
    : data.judgedSessions ?? 0;
  const reviewScoreCount = data.judgeComparability?.denominator ?? data.judgedSessions ?? 0;
  const reviewMethodCopy = data.judgeComparability?.mixed
    ? "Saved review records use more than one source or model. Receipts remain intact, but the comparable score uses only the shared denominator."
    : "Saved review records share one source, model, and prompt version. Receipt count and comparable score count are intentionally different.";

  return (
    <div className="min-w-0 p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/collection" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-2"><ArrowLeft className="size-3.5" /> Collection</Link>
      <PageHeader
        icon={Activity}
        title={<>Timeline &amp; comparisons</>}
        subtitle="See what changed around adoption. These are descriptive windows, not causal proof."
        actions={
          <div className="flex flex-wrap items-center gap-2" aria-label="Timeline actions">
            <button
              type="button"
              onClick={() => { void refreshData(); }}
              disabled={timelineLoading}
              title="Refresh the timeline while keeping the current report visible."
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <RefreshCw className={clsx("size-3.5", timelineLoading && "animate-spin")} /> {timelineLoading ? "Refreshing…" : "Refresh"}
            </button>
            <details ref={judgePopoverRef} className="relative" onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.open = false; }}>
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                <Gavel className="size-3.5" /> Add outcome evidence <ChevronDown className="size-3.5" />
              </summary>
              <div className="timeline-judge-popover absolute right-0 top-full z-40 mt-2 rounded-xl border border-bd bg-bg-subtle p-3 shadow-2xl">
                <p className="px-1 py-1 text-[11px] leading-snug text-fg-dim">Add model-reviewed outcome labels around adoption. They show association, not cause.</p>
                <div className="my-3 rounded-lg border border-bd-subtle bg-bg/40 px-3 py-3">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-muted">Review method</div>
                  <JudgePicker value={judgeSelection} onChange={(next) => { setJudgeSelection(next); setJudgeReadiness({ readiness: "unknown", detail: "Checking judge readiness…" }); }} onReadinessChange={handleJudgeReadiness} idPrefix="timeline-judge" />
                </div>
                <button
                  type="button"
                  onClick={refineWithJudge}
                  disabled={judging || !!job?.running || judgeReadiness.readiness !== "ready"}
                  title="Judge up to 10 new sessions in the adoption windows."
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
                >
                  <Gavel className={clsx("size-3.5", judging && "animate-pulse")} />
                  <span><span className="block">{judging ? "Reviewing…" : "Review a sample"}</span><span className="block text-[10px] text-fg-dim">Up to 10 new sessions</span></span>
                </button>
                <button
                  type="button"
                  onClick={judgeAllWindows}
                  disabled={judging || !!job?.running || judgeReadiness.readiness !== "ready"}
                  title="Judge every unjudged session in the adoption windows."
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
                >
                  <Scale className={clsx("size-3.5", job?.running && "animate-pulse")} />
                  <span><span className="block">{job?.running ? "Reviewing all…" : "Review all windows"}</span><span className="block text-[10px] text-fg-dim">Runs in the background; you can leave this page</span></span>
                </button>
              </div>
            </details>
          </div>
        }
      />

      <div className="lg:hidden">
        <ProgressiveSectionNav
          sections={sections}
          activeSection={activeSection}
          onSelect={selectSection}
          summary={`${fmtInt(data.totalSessions)} top-level sessions · ${pct(data.signalCoverage)} signal${data.excludedSubagentSessions ? ` · ${fmtInt(data.excludedSubagentSessions)} child traces retained` : ""}`}
        />
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(11rem,13rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className="hidden lg:sticky lg:top-4 lg:block lg:self-start" aria-label="Timeline evidence rail">
          <nav className="rounded-lg border border-bd bg-bg-subtle p-2" aria-label="Timeline evidence navigation">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">Evidence room</div>
            <div className="mt-2 rounded-md border border-bd-subtle bg-bg-elev px-2 py-2" aria-label="Timeline evidence status">
              <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">Current status</div>
              <div className={clsx("mt-1 text-[11px] font-medium", timelinePhase === "fresh" ? "text-ok" : timelinePhase === "error" ? "text-err" : "text-warn")}>
                {timelinePhase === "fresh" ? "Up to date" : timelinePhase === "loading" ? "Updating" : timelinePhase === "stale" ? "May be out of date" : "Update needs attention"}
              </div>
            </div>
            <div className="mt-3 space-y-1" aria-label="Timeline sections">
              <button
                type="button"
                onClick={() => selectSection("all")}
                aria-pressed={activeSection === "all"}
                aria-current={activeSection === "all" ? "page" : undefined}
                className={clsx(
                  "flex min-h-10 w-full items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  activeSection === "all" ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-transparent text-fg-muted hover:bg-bg-elev hover:text-fg",
                )}
              >
                <span className="min-w-0"><span className="block text-xs font-medium">All evidence</span><span className="block truncate text-[10px] text-fg-dim">Full report</span></span>
                <span className="mono shrink-0 text-[9px] text-fg-dim">{sections.length}</span>
              </button>
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSection(section.id)}
                  aria-pressed={activeSection === section.id}
                  aria-current={activeSection === section.id ? "page" : undefined}
                  className={clsx(
                    "flex min-h-10 w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    activeSection === section.id ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-transparent text-fg-muted hover:bg-bg-elev hover:text-fg",
                  )}
                >
                  <span className="mono w-5 shrink-0 pt-0.5 text-[9px] text-fg-dim">{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0"><span className="block text-xs font-medium">{section.label}</span><span className="block line-clamp-2 text-[10px] leading-snug text-fg-dim">{section.description}</span></span>
                </button>
              ))}
            </div>
            <div className="mt-3 border-t border-bd-subtle px-2 pt-3" aria-label="Score and receipt counts">
              <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-fg-muted">Outcome source</div>
              <div className="mt-1 mono text-sm font-semibold tabular-nums text-fg">{fmtInt(seriesN)}/{fmtInt(seriesDenominator)}</div>
              <div className="text-[10px] leading-snug text-fg-dim">top-level sessions with signal</div>
              <div className="mt-2 text-[9px] font-medium uppercase tracking-[0.12em] text-fg-muted">Judge receipts</div>
              <div className="mt-1 mono text-sm font-semibold tabular-nums text-fg">{fmtInt(retainedJudgeReceiptCount)}</div>
              <div className="text-[10px] leading-snug text-fg-dim">saved review records</div>
              <p className="mt-2 text-[10px] leading-snug text-fg-dim">Receipt count ≠ comparable score denominator.</p>
            </div>
          </nav>
        </aside>

        <div className="min-w-0">
      <div
        className={clsx(
          "mb-4 flex flex-wrap items-center gap-2 rounded-lg border text-sm",
          timelinePhase === "fresh" ? "px-2.5 py-1.5" : "p-3",
          timelinePhase === "fresh" && "border-bd-subtle bg-bg-subtle text-fg-dim text-xs",
          timelinePhase === "loading" && "border-accent/30 bg-accent/5 text-accent-soft",
          timelinePhase === "stale" && "border-warn/40 bg-warn/10 text-warn",
          timelinePhase === "error" && "border-err/40 bg-err/10 text-err",
        )}
        role={timelinePhase === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
      >
        {timelinePhase === "fresh" && <CheckCircle2 className="size-4 shrink-0" />}
        {timelinePhase === "loading" && <Loader2 className="size-4 shrink-0 animate-spin" />}
        {(timelinePhase === "stale" || timelinePhase === "error") && <AlertTriangle className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          {timelinePhase === "fresh" && <>Updated {timelineUpdatedAt ? new Date(timelineUpdatedAt).toLocaleTimeString() : "from the server"}</>}
          {timelinePhase === "loading" && <>Refreshing timeline… The current report stays visible.</>}
          {timelinePhase === "stale" && <>Timeline evidence may be stale while judge-window results finish. The current report remains visible.</>}
          {timelinePhase === "error" && <><span className="font-medium">{timelineError ? "Timeline evidence refresh failed." : "Judge-window status unavailable."}</span> <span className="text-fg-muted">{timelineStatusError ?? "The current report may be stale."}</span></>}
        </span>
        {timelinePhase !== "fresh" && (
          <button
            type="button"
            onClick={() => { void retryTimeline(); }}
            disabled={timelineLoading}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-current/30 px-2.5 py-2 text-xs hover:bg-bg-elev transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={clsx("size-3.5", timelineLoading && "animate-spin")} /> Retry
          </button>
        )}
      </div>

      {isVisible("overview") && <section id="overview" aria-label="Timeline evidence overview" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-accent-soft">Decision snapshot</div>
            <h2 className="mt-1 text-base font-semibold tracking-tight">Evidence at a glance</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted">Adoption, outcome, and judge evidence stay separate so a promising change is not mistaken for a causal result.</p>
          </div>
          <div className="text-right text-[10px] text-fg-dim">
            <div>Observed window</div>
            <div className="mono tabular-nums text-fg-muted">{fmtDate(data.dateStart)} → {fmtDate(data.dateEnd)}</div>
          </div>
        </div>

        {/* HERO: the outcome curve is the page's thesis — it leads, full width, tallest. */}
        <div id="outcome" className="card mb-3 min-w-0 scroll-mt-16 p-4">
          <details className="evidence-accordion mb-3 group rounded-md border border-bd-subtle bg-bg-elev text-[11px] leading-snug text-fg-muted" role="note">
            <summary className="flex cursor-pointer select-none items-center gap-2 p-2.5 [&::-webkit-details-marker]:hidden">
              <Info className="size-3.5 shrink-0 text-accent-soft" aria-hidden />
              <span className="font-medium text-fg">About this metric</span>
              <span className="text-fg-dim">— trailing median · {trendComparable ? "comparable halves" : "not comparable"} · {data.outcomeSeries.length} plotted</span>
              <ChevronDown className="ml-auto size-3.5 shrink-0 text-fg-dim transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-bd-subtle px-2.5 py-2.5">
              It is a trailing median from {seriesBasisCopy}, using {seriesN}/{seriesDenominator} top-level sessions ({pct(seriesCoverage)}). The two halves are {trendComparable ? "comparable" : "not comparable"}. {retainedJudgeReceiptCount} judge receipts are retained separately, and missing-signal sessions are not counted as zero. {data.outcomeSeries.length} points are plotted after downsampling.
            </div>
          </details>
          <OutcomeChart series={data.outcomeSeries} markers={visibleMarkers} changePoints={data.changePoints ?? []} evidence={seriesEvidence} />
        </div>

        {/* Metric rail: four slim segments, one strip — numbers support the chart, not compete. */}
        <div className="rail-stagger grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-bd bg-bd-subtle sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-bg-subtle p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Corpus</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{fmtInt(data.totalSessions)}</div>
            <div className="text-[11px] leading-snug text-fg-dim">top-level sessions · {data.markers.length} adoption markers</div>
            {(data.excludedSubagentSessions ?? 0) > 0 && (
              <div className="mt-1 text-[10px] text-accent-soft">
                <span className="mono tabular-nums">{fmtInt(data.excludedSubagentSessions ?? 0)}</span> child traces retained in Collection, excluded here
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-dim">
              {(["skill", "mcp", "subagent", "model"] as MarkerKind[]).map((k) => {
                const n = markerCounts[k];
                if (n === 0) return null;
                return (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
                    <span className="tabular-nums mono">{n}</span> {KIND_LABEL[k]}{n === 1 ? "" : "s"}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="bg-bg-subtle p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Outcome movement</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className={clsx("flex items-center gap-1 text-lg font-semibold tabular-nums", !trendComparable ? "text-fg-dim" : trend >= 0 ? "text-ok" : "text-err")}>
                <TrendIcon className="size-4" /> {trendComparable ? signed(trend) : "—"}
              </span>
              <span className="text-[11px] text-fg-dim tabular-nums">{trendComparable ? `${data.overall.firstHalfOutcome.toFixed(2)} → ${data.overall.secondHalfOutcome.toFixed(2)}` : "not comparable"}</span>
            </div>
            <div className="text-[11px] leading-snug text-fg-dim">{trendComparable ? `Median · n=${firstHalfN} / ${secondHalfN} signal sessions` : `needs signal in both halves · ${firstHalfN}/${secondHalfN} available`}</div>
            {trendComparable && <>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-[3.5rem] shrink-0 text-[10px] text-fg-dim">Before</span>
                <div className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-bg-elev" aria-hidden>
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${data.overall.firstHalfOutcome * 100}%`, background: "color-mix(in srgb, var(--color-accent) 35%, transparent)" }} />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">{data.overall.firstHalfOutcome.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="w-[3.5rem] shrink-0 text-[10px] text-fg-dim">After</span>
                <div className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-bg-elev" aria-hidden>
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${data.overall.secondHalfOutcome * 100}%`, background: "color-mix(in srgb, var(--color-accent) 75%, transparent)" }} />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">{data.overall.secondHalfOutcome.toFixed(2)}</span>
              </div>
            </>}
          </div>
          <div className="bg-bg-subtle p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Evidence posture</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{pct(data.signalCoverage)}</div>
            <div className="text-[11px] leading-snug text-fg-dim">
              <span className="tabular-nums">{fmtInt(data.signalSessions ?? Math.round(data.signalCoverage * data.totalSessions))}</span> of {fmtInt(data.totalSessions)} with outcome signal
              {(data.judgedSessions ?? 0) > 0 && <span className="text-accent-soft"> · <span className="tabular-nums">{fmtInt(data.judgedSessions ?? 0)}</span> model-reviewed</span>}
            </div>
            <EvidenceComposition
              className="mt-2"
              label="Outcome basis"
              total={data.totalSessions}
              note={`Model-reviewed and rule-based scores use different evidence sources; the comparable score denominator is separate from the ${retainedJudgeReceiptCount} saved review record${retainedJudgeReceiptCount === 1 ? "" : "s"}.`}
              segments={[
                { label: "Model-reviewed", value: data.judgedSessions ?? Math.round(data.judgedCoverage * data.totalSessions), tone: "judged" },
                { label: "Rule-based", value: data.heuristicSignalSessions ?? Math.round(Math.max(0, data.signalCoverage - data.judgedCoverage) * data.totalSessions), tone: "heuristic" },
                { label: "No outcome signal", value: data.noSignalSessions ?? Math.round(Math.max(0, 1 - data.signalCoverage) * data.totalSessions), tone: "none" },
              ]}
            />
          </div>
          <div className="bg-bg-subtle p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Comparisons</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{fmtInt(data.impacts.length)}</div>
            <div className="text-[11px] leading-snug text-fg-dim">adoptions with comparison history</div>
            <div className="mt-2 space-y-1 border-t border-bd-subtle pt-2 text-[10px] text-fg-dim">
              <div className="flex items-center justify-between gap-2"><span>Low-confidence rows</span><span className="tabular-nums text-warn">{lowConfidenceImpactCount}</span></div>
              <div className="flex items-center justify-between gap-2"><span>Model-reviewed coverage</span><span className="tabular-nums text-accent-soft">{pct(data.judgedCoverage)}</span></div>
              <div className="flex items-center justify-between gap-2"><span>Window basis</span><span className="tabular-nums">20 / 20</span></div>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-fg-dim">Rows with too little outcome evidence stay visible and are marked not comparable.</p>
          </div>
        </div>
      </section>}




      <section className="mb-5 min-w-0 rounded-lg border border-bd bg-bg-subtle p-3" aria-labelledby="adoption-scope-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Filter className="size-3.5 text-accent-soft" aria-hidden />
              <h2 id="adoption-scope-title" className="text-xs font-semibold">Adoption scope</h2>
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-snug text-fg-dim">Filter adoption markers, comparison rows, and history by kind. Global shifts stay visible and are never attributed by this filter.</p>
          </div>
          <div className="text-[10px] text-fg-dim mono tabular-nums" aria-live="polite">{visibleMarkers.length} markers · {visibleImpacts.length} comparisons</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter markers by kind">
        <button
          type="button"
          onClick={() => applyKindFilter("all")}
          aria-pressed={kindFilter === "all"}
          className={clsx(
            "min-h-9 rounded-full border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            kindFilter === "all" ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev hover:text-fg",
          )}
        >
          All <span className="mono tabular-nums text-fg-dim">{data.markers.length}</span>
        </button>
        {MARKER_KINDS.map((k) => {
          const n = markerCounts[k];
          if (n === 0) return null;
          return (
            <button
              key={k}
              type="button"
              onClick={() => applyKindFilter(kindFilter === k ? "all" : k)}
              aria-pressed={kindFilter === k}
              className={clsx(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                kindFilter === k ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev hover:text-fg",
              )}
            >
              <span className="size-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} aria-hidden />
              {KIND_LABEL[k]}s <span className="mono tabular-nums text-fg-dim">{n}</span>
            </button>
          );
        })}
        </div>
      </section>

      {err && <div className="card p-3 mb-4 text-sm text-err flex items-center gap-2"><AlertTriangle className="size-4" /> {err}</div>}
      {judgeMsg && (
        <div className="timeline-judge-result mb-4 rounded-xl border" role="status">
          <div className="timeline-judge-result__icon" aria-hidden>
            <Gavel className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="timeline-judge-result__eyebrow">Latest review run</div>
            <div className="timeline-judge-result__message">{judgeMsg}</div>
          </div>
        </div>
      )}
      {data.judgeSelectionDistribution && data.judgeSelectionDistribution.length > 0 && (
        <div className={clsx("timeline-review-status mb-4 rounded-xl border p-3 text-sm", data.judgeComparability?.mixed && "timeline-review-status--mixed")} role="status">
          <div className="timeline-review-status__main">
            <div className="timeline-review-status__summary">
              <div className="timeline-review-status__title-row">
                <span className={clsx("timeline-review-status__icon shrink-0", data.judgeComparability?.mixed ? "text-warn" : "text-ok")} aria-hidden>
                  {data.judgeComparability?.mixed ? <Info className="size-4" /> : <CheckCircle2 className="size-4" />}
                </span>
                <div className="min-w-0">
                  <div className="timeline-review-status__eyebrow">Review evidence</div>
                  <div className="font-medium text-fg">{data.judgeComparability?.mixed ? "Multiple review methods" : "Review method recorded"}</div>
                </div>
              </div>
              <p className={clsx("timeline-review-status__copy", data.judgeComparability?.mixed ? "text-warn" : "text-fg-muted")}>
                {data.judgeComparability?.mixed ? `${data.judgeComparability.warning} ${reviewMethodCopy}` : reviewMethodCopy}
              </p>
            </div>
            <div className="timeline-review-status__stats" aria-label="Review evidence counts">
              <span className="timeline-review-stat"><span>Saved receipts</span><strong>{retainedJudgeReceiptCount}</strong></span>
              <span className="timeline-review-stat"><span>Comparable scores</span><strong>{reviewScoreCount}</strong></span>
              {(data.judgeComparability?.staleReceiptCount ?? 0) > 0 && (
                <span className="timeline-review-stat" title="Receipts saved under an older prompt version. They stay on disk but cannot be compared with current scores; the next review pass re-judges them.">
                  <span>Stale (re-judging)</span>
                  <strong className="text-warn">{data.judgeComparability!.staleReceiptCount}</strong>
                </span>
              )}
            </div>
            {(data.judgeComparability?.staleReceiptCount ?? 0) > 0 && (
              <p className="timeline-review-status__copy mt-1 text-[11px] text-fg-dim">
                {data.judgeComparability!.staleReceiptCount} receipt{(data.judgeComparability!.staleReceiptCount) === 1 ? " was" : "s were"} saved under an older prompt contract — excluded from judged provenance and comparable scores until re-reviewed.
              </p>
            )}
          </div>
          <div className="timeline-review-status__methods" aria-label="Recorded review methods">
            <div className="timeline-review-status__methods-heading">Saved review methods</div>
            <div className="timeline-review-status__method-list">
              {data.judgeSelectionDistribution.map((group) => {
                const sourceLabel = group.source === "unknown" ? "Source unavailable" : group.source;
                const modelLabel = group.model === "unknown" ? "Model unavailable" : group.model;
                return (
                  <span key={`${group.source}-${group.model}-${group.promptVersion}`} className="timeline-review-method">
                    <span className="timeline-review-method__identity">{sourceLabel} · {modelLabel}</span>
                    <span className="timeline-review-method__meta">{group.reasoningEffort ? `${group.reasoningEffort} · ` : ""}prompt v{group.promptVersion ?? "?"} · {group.count} receipt{group.count === 1 ? "" : "s"}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {job && job.startedAt && (job.running || job.total > 0 || job.failed > 0) && (
        <div className={clsx("timeline-job-receipt mb-4 rounded-xl border", !job.running && "text-xs")}>
          <div className="timeline-job-receipt__summary">
            <div className="timeline-job-receipt__icon" aria-hidden>
              <Scale className={clsx("size-4", job.running && "animate-pulse")} />
            </div>
            <div className="min-w-0">
              <div className="timeline-job-receipt__eyebrow">{job.running ? "Background review in progress" : job.state === "interrupted" ? "Background review interrupted" : "Background review finished"}</div>
              <div className="timeline-job-receipt__message">
                {job.running
                  ? <>Judging marker windows: <span className="mono tabular-nums text-fg">{job.done}/{job.total}</span>{job.failed > 0 && <span className="text-warn"> ({job.failed} failed)</span>} via {job.selection?.judgeName ?? job.judge} — safe to leave this page.</>
                  : <>{job.state === "interrupted" ? <>Background judging interrupted: {job.judged}/{job.total} judged so far</> : <>Background judging finished: {job.judged}/{job.total} judged</>}{job.failed > 0 && <span className="text-warn"> ({job.failed} failed{job.lastError ? ` — ${job.lastError}` : ""})</span>} via {job.selection?.judgeName ?? job.judge}.</>}
              </div>
            </div>
            <span className={clsx("timeline-job-receipt__state", job.running && "timeline-job-receipt__state--live", !job.running && job.state === "interrupted" && "timeline-job-receipt__state--warn")}>{job.running ? "running" : job.state}</span>
          </div>
          <details className="evidence-accordion timeline-job-receipt__details" aria-label="Durable judge job receipt" open={job.running}>
            <summary className="flex cursor-pointer select-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <div className="timeline-job-receipt__details-heading">
                <div className="timeline-job-receipt__details-title">Durable job receipt</div>
                <div className="timeline-job-receipt__details-caption">Persisted run metadata — {job.running ? "open while running" : "collapsed"}</div>
              </div>
              <ChevronDown className="ml-auto size-3.5 shrink-0 text-fg-dim transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] sm:grid-cols-4">
              <div><dt className="text-fg-dim">State</dt><dd className="mono text-fg-muted">{job.state}</dd></div>
              <div><dt className="text-fg-dim">Judge source</dt><dd className="mono break-all text-fg-muted">{job.selection?.source ?? "legacy"}</dd></div>
              <div><dt className="text-fg-dim">Model</dt><dd className="mono break-all text-fg-muted">{(job.selection?.model ?? job.judge) || "—"}</dd></div>
              <div><dt className="text-fg-dim">Effort</dt><dd className="mono text-fg-muted">{job.selection?.reasoningEffort ?? "—"}</dd></div>
              <div><dt className="text-fg-dim">Started</dt><dd className="mono text-fg-muted">{new Date(job.startedAt).toLocaleString()}</dd></div>
              <div><dt className="text-fg-dim">Finished</dt><dd className="mono text-fg-muted">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "in progress"}</dd></div>
              <div><dt className="text-fg-dim">Lease</dt><dd className="mono text-fg-muted">{job.running ? (job.leaseExpiresAt ? `until ${new Date(job.leaseExpiresAt).toLocaleTimeString()}` : "active") : "released"}</dd></div>
              <div><dt className="text-fg-dim">Counts</dt><dd className="mono tabular-nums text-fg-muted">{job.judged} judged · {job.failed} failed</dd></div>
            </dl>
            {job.lastError && (
              <div className="timeline-job-receipt__recovery text-warn">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                <span><span className="font-medium">Recovery detail:</span> {job.lastError}</span>
              </div>
            )}
          </details>
          {job.running && job.total > 0 && (
            <div className="mt-2 h-[5px] rounded-full bg-bg-elev overflow-hidden" role="progressbar" aria-label="Judge-window progress" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done} aria-valuetext={`${job.done} of ${job.total} sessions judged`}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.min(100, (job.done / job.total) * 100)}%`, background: "var(--color-accent)" }}
              />
            </div>
          )}
        </div>
      )}

      {isVisible("impact") && <section id="impact" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
        <SectionHeader
          icon={GitCompareArrows}
          title="Adoption comparisons"
          desc="Before/after windows around first use. Correlation only; caveats stay visible."
          right={`${renderedImpacts.length}/${visibleImpacts.length} rows${kindFilter === "all" ? "" : ` · ${data.impacts.length} total`}`}
        />
        <div className="card mb-3 min-w-0 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold">Outcome delta per adoption</h3>
            <span className="text-[10px] text-fg-dim">after-window median − before-window median · comparable rows</span>
          </div>
          <DivergingDeltaChart
            items={visibleImpacts.map((im) => ({
              name: im.marker.name,
              kind: im.marker.kind,
              delta: im.outcomeComparable === false ? null : im.deltas.outcome,
              color: KIND_COLOR[im.marker.kind],
            }))}
          />
        </div>
        <div className="card min-w-0 overflow-hidden">
        <div className="border-b border-bd-subtle px-3 py-3 text-[11px] text-fg-dim">
          <p id="impact-method"><span className="font-medium text-fg">Method.</span> Each row compares the median of up to 20 sessions before first use with up to 20 after. Outcome n is the actual usable outcome denominator; tool, cost, and turn metrics use the full comparison windows.</p>
          <div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-3">
            <span><span className="font-medium text-fg-muted">Δ</span> = after median − before median</span>
            <span><span className="font-medium text-ok">Outcome up</span> is favorable; lower tool errors/cost are favorable</span>
            <span className="text-warn">Association only — confounds and thin samples are not causal proof</span>
          </div>
        </div>
        <div
          className="chart-scroll-well overflow-x-auto pb-2"
          role="region"
          tabIndex={0}
          aria-label="Adoption comparison table. Scroll horizontally to inspect all metrics."
          aria-describedby="impact-scroll-hint"
        >
          <table className="data-table min-w-[760px]" aria-describedby="impact-method">
            <caption className="sr-only">Adoption comparison table with before and after medians, sample sizes, judge coverage, and caveats.</caption>
            <thead>
              <tr>
                <th scope="col" className={STICKY_TH}>Adoption / evidence</th>
                <th scope="col" className="num">Outcome median Δ</th>
                <th scope="col" className="num">Tool error rate Δ</th>
                <th scope="col" className="num">Cost / session Δ</th>
                <th scope="col" className="num">Tools / turn Δ</th>
                <th scope="col" className="pl-4">Caveats</th>
              </tr>
            </thead>
            <tbody>
              {data.impacts.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-fg-dim text-sm">Not enough history around any adoption yet.</td></tr>
              )}
              {data.impacts.length > 0 && visibleImpacts.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-fg-dim text-sm">No measured {kindFilter === "all" ? "" : `${KIND_LABEL[kindFilter as MarkerKind]} `}adoptions match the current marker filter.</td></tr>
              )}
              {(() => {
                const maxDelta = Math.max(
                  ...visibleImpacts.filter((x) => x.outcomeComparable !== false).map((x) => Math.abs(x.deltas.outcome)),
                  1e-9,
                );
                return renderedImpacts.map((im) => {
                const Icon = KIND_ICON[im.marker.kind];
                return (
                  <tr key={`${im.marker.kind}-${im.marker.name}`}>
                    <th scope="row" className={STICKY_TD}>
                      <div className="flex items-center gap-1.5">
                        <Icon className="size-3.5 shrink-0" style={{ color: KIND_COLOR[im.marker.kind] }} />
                        <span className="font-medium truncate max-w-[160px] md:max-w-[240px]" title={im.marker.name}>{im.marker.name}</span>
                        {im.lowConfidence && <span className="shrink-0 rounded border border-warn px-1 text-[9px] uppercase tracking-wide text-warn" title="Thin sample or mixed outcome provenance">thin evidence</span>}
                      </div>
                      <div className="text-[10px] text-fg-dim mono">
                        {KIND_LABEL[im.marker.kind]} · first seen {fmtDate(im.marker.firstSeenAt)} · {im.marker.observedIn === "child" ? "child traces only" : im.marker.observedIn === "both" ? "top-level + child" : "top-level"}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-fg-dim mono tabular-nums">
                        <span title="Full comparison window sample size">window n={im.nBefore}/{im.nAfter}</span>
                        {im.comparability !== "comparable" && (
                          <span
                            className={clsx("uppercase tracking-[0.08em]", im.comparability === "child-only" ? "text-warn" : "text-fg-muted")}
                            title={{ "thin": "One or both sides have too few outcome observations for a stable median", "unavailable": "No outcome evidence on one side", "mixed-provenance": "The before/after pools mix model-reviewed and rule-based scores", "child-only": "Observed only in child traces — no top-level effect" }[im.comparability] ?? "Comparison is not fully comparable"}
                          >
                            {im.comparability}
                          </span>
                        )}
                        <span title={`Outcome pool: ${im.outcomePoolBefore} before and ${im.outcomePoolAfter} after`}>
                          outcome n={im.outcomeNBefore ?? im.signalBefore ?? im.nBefore}/{im.outcomeNAfter ?? im.signalAfter ?? im.nAfter} · pool {im.outcomePoolBefore}/{im.outcomePoolAfter}
                        </span>
                        {im.judgedBefore > 0 || im.judgedAfter > 0 ? (
                          <span className={im.judgedBefore >= 5 && im.judgedAfter >= 5 ? "text-accent-soft" : "text-fg-dim"} title={im.judgedBefore >= 5 && im.judgedAfter >= 5 ? "Outcome medians on both sides use model-reviewed verdicts only" : "Some sessions are model-reviewed; reviewed-only medians require 5 per side"}>
                            reviewed {im.judgedBefore}/{im.judgedAfter}
                          </span>
                        ) : <span>reviewed 0/0</span>}
                      </div>
                      {/* Keep the legacy title-level sample explanation available to pointer users. */}
                      <span className="sr-only">
                        Outcome medians use {im.outcomePoolBefore} scores before and {im.outcomePoolAfter} scores after.
                      </span>
                    </th>
                    <td className="num">
                      {im.outcomeComparable === false
                        ? <span className="text-fg-dim" title="No usable outcome evidence on one side">—</span>
                        : <span className="inline-flex items-center gap-1.5">
                            <DeltaBar value={im.deltas.outcome} max={maxDelta} />
                            {im.effectSize != null && im.strength !== "unavailable" && (
                              <span
                                className={clsx(
                                  "rounded-sm border px-1 py-px text-[9px] uppercase tracking-[0.08em]",
                                  im.strength === "large" || im.strength === "moderate"
                                    ? "border-accent/30 bg-accent/10 text-accent-soft"
                                    : im.strength === "small" ? "border-bd-subtle bg-bg-subtle text-fg-muted" : "border-bd-subtle text-fg-dim",
                                )}
                                title={`Standardized mean difference ${im.effectSize.toFixed(2)} (${im.strength}). effect size gates how much of the delta is signal versus sample noise.`}
                              >
                                {im.strength}
                              </span>
                            )}
                          </span>}
                    </td>
                    <td className="num">{im.windowComparable !== false && im.nBefore > 0 && im.nAfter > 0 ? <Delta value={im.deltas.toolErrorRate} lowerIsBetter fmt={(v) => signed(v * 100, 0) + "%"} /> : <span className="text-fg-dim" title="No sessions on one side of the comparison">—</span>}</td>
                    <td className="num">{im.windowComparable !== false && im.nBefore > 0 && im.nAfter > 0 ? <Delta value={im.deltas.costUsd} lowerIsBetter fmt={(v) => "$" + v.toFixed(2)} /> : <span className="text-fg-dim" title="No sessions on one side of the comparison">—</span>}</td>
                    <td className="num">{im.windowComparable !== false && im.nBefore > 0 && im.nAfter > 0 ? <Delta value={im.deltas.toolCallsPerTurn} lowerIsBetter fmt={(v) => signed(v, 1)} /> : <span className="text-fg-dim" title="No sessions on one side of the comparison">—</span>}</td>
                    <td className="pl-4 align-top">
                      {im.confounds.length > 0 ? (
                        <details className="text-[10px] text-warn">
                          <summary className="flex cursor-pointer list-none items-start gap-1 leading-snug [&::-webkit-details-marker]:hidden">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                            <span><span className="font-medium">{im.confounds.length} caveat{im.confounds.length === 1 ? "" : "s"}</span><span className="block text-fg-muted">{im.confounds[0]}</span></span>
                          </summary>
                          {im.confounds.length > 1 && <ul className="mt-1 space-y-1 pl-4 list-disc text-fg-muted">{im.confounds.slice(1).map((confound) => <li key={confound}>{confound}</li>)}</ul>}
                        </details>
                      ) : <span className="text-[10px] text-ok">No flagged caveat</span>}
                    </td>
                  </tr>
                );
                });
              })()}
            </tbody>
          </table>
        </div>
        <p id="impact-scroll-hint" className="px-3 pb-2 text-[10px] text-fg-dim sm:hidden">
          Swipe or shift-scroll to inspect all comparison metrics.
        </p>
        {renderedImpacts.length < visibleImpacts.length && (
          <div className="flex items-center justify-between gap-3 border-t border-bd-subtle px-3 py-2">
            <span className="text-[11px] text-fg-dim">Showing the first {renderedImpacts.length} measured adoptions.</span>
            <button
              type="button"
              onClick={() => setImpactVisibleCount((count) => Math.min(count + TIMELINE_IMPACT_WINDOW, visibleImpacts.length))}
              className="min-h-10 rounded border border-bd bg-bg-elev px-2.5 py-2 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Show {Math.min(TIMELINE_IMPACT_WINDOW, visibleImpacts.length - renderedImpacts.length)} more
            </button>
          </div>
        )}
        </div>
      </section>
      }

      {/* Does spend buy success? Cost (log) vs deterministic outcome, per session.
          Judged cloud on top so model-reviewed sessions stay visible. */}
      {isVisible("impact") && (
      <section id="cost-outcome" className={clsx("scroll-mt-16", sectionVisibilityClass(true))}>
        <SectionHeader
          icon={ScatterChart}
          title="Cost vs. outcome"
          desc="Each dot is one session: cost on a log scale against its outcome score. Judged sessions render on top of heuristic ones."
        />
        <div className="card p-4">
          <CostVsOutcome points={data.outcomeScatter} evidence={data.outcomeScatterEvidence} />
        </div>
      </section>
      )}

      {isVisible("adoptions") && (
        <section id="adoptions" className={clsx("scroll-mt-16", sectionVisibilityClass(true))}>
        <SectionHeader
          icon={CalendarPlus}
          title="Adoption history"
          desc="When each adoption first appeared. Not an effectiveness ranking."
          right={`${renderedMarkers.length}/${visibleMarkers.length} shown${kindFilter === "all" ? "" : ` · ${data.markers.length} total`}`}
        />
        <div className="card min-w-0 overflow-hidden">
        <div className="border-b border-bd-subtle px-4 py-3 text-[11px] leading-snug text-fg-dim">
          Each marker records when it first appeared and how often it was seen. Scope labels show where it came from; frequency is not effectiveness.
        </div>
        <div className="max-h-[480px] overflow-y-auto px-4 py-3" aria-label="Adoption history list">
          {(() => {
            // Newest first, grouped by month; each group renders on a shared rail.
            if (visibleMarkers.length === 0) {
              return <p className="text-sm text-fg-dim py-4 text-center">No adoptions match the current marker filter.</p>;
            }
            const groups: Array<{ label: string; items: typeof data.markers }> = [];
            for (const m of renderedMarkers) {
              const label = new Date(m.firstSeenAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
              const last = groups[groups.length - 1];
              if (last && last.label === label) last.items.push(m);
              else groups.push({ label, items: [m] });
            }
            const maxFreq = Math.max(1, ...renderedMarkers.map((m) => m.sessionCount));
            return groups.map((g) => (
              <div key={g.label} className="relative pl-4">
                                <div className="absolute left-[3px] top-1 bottom-0 w-px bg-bd/60" aria-hidden />
                <div className="sticky top-0 z-[1] -ml-4 pl-4 py-1 bg-bg-subtle text-[10px] uppercase tracking-[0.12em] text-fg-muted">
                  {g.label}
                </div>
                <ul aria-label={`${g.label} adoption markers`}>
                  {g.items.map((m) => {
                    const Icon = KIND_ICON[m.kind];
                    const scope = m.observedIn === "both"
                      ? "top-level + child traces"
                      : m.observedIn === "child"
                        ? "child traces"
                        : "top-level traces";
                    const topLevelCount = m.topLevelSessionCount ?? (m.observedIn === "child" ? 0 : m.sessionCount);
                    const retainedCount = m.evidenceSessionCount ?? m.sessionCount;
                    return (
                      <li key={`${m.kind}-${m.name}`} className="relative py-1 group">
                        <span
                          className="absolute -left-[15px] top-[9px] size-[7px] rounded-full ring-2 ring-bg-subtle"
                          style={{ background: KIND_COLOR[m.kind] }}
                          aria-hidden
                        />
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="mono text-[10px] text-fg-dim tabular-nums shrink-0 w-14">{fmtDate(m.firstSeenAt).slice(5)}</span>
                          <Icon className="size-3 shrink-0" style={{ color: KIND_COLOR[m.kind] }} />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-fg group-hover:text-accent-soft transition-colors">{m.name}</span>
                          {m.observedIn === "child" && <span className="shrink-0 rounded border border-accent/30 px-1 text-[9px] uppercase tracking-wide text-accent-soft" title="Observed only in retained child-agent traces">child-only</span>}
                          {m.observedIn === "both" && <span className="shrink-0 rounded border border-bd px-1 text-[9px] uppercase tracking-wide text-fg-dim" title="Observed in both top-level and child-agent traces">both</span>}
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            <span className="hidden h-[4px] w-24 min-w-0 overflow-hidden rounded-full bg-bg-elev sm:block" aria-hidden>
                              <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(4, (m.sessionCount / maxFreq) * 100)}%`, background: KIND_COLOR[m.kind] }} />
                            </span>
                            <span className={clsx("mono text-[10px] tabular-nums", m.sessionCount >= maxFreq / 2 ? "text-fg font-medium" : "text-fg-dim")} title={`used in ${m.sessionCount} top-level session${m.sessionCount === 1 ? "" : "s"}`}>
                              ×{m.sessionCount}
                            </span>
                            <EvidenceReview
                              identity={`timeline/${m.kind}/${m.name}`}
                              source={`Timeline aggregate · ${scope}`}
                              provenance={`Observed in ${scope}; ${topLevelCount} top-level denominator session${topLevelCount === 1 ? "" : "s"}, ${retainedCount} retained trace${retainedCount === 1 ? "" : "s"}`}
                              transcript={{
                                status: "search",
                                detail: "This marker keeps aggregate evidence, not per-session transcript paths. Collection search resolves source-qualified sessions.",
                                href: `/collection?q=${encodeURIComponent(m.name)}`,
                                linkLabel: "Find matching sessions",
                              }}
                              caveats={[
                                m.observedIn === "child" ? "Child-only evidence is retained but excluded from outcome denominators." : null,
                                m.observedIn === "both" ? "Child traces are retained separately; only top-level sessions feed impact denominators." : null,
                                "Marker frequency is descriptive and is not an effectiveness claim.",
                                "Timeline comparisons remain correlational, with confounds shown on the comparison rows.",
                              ].filter((caveat): caveat is string => Boolean(caveat))}
                            />
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ));
          })()}
        </div>
        {renderedMarkers.length < visibleMarkers.length && (
          <div className="flex items-center justify-between gap-3 border-t border-bd-subtle px-4 py-2">
            <span className="text-[11px] text-fg-dim">Showing the newest {renderedMarkers.length} adoptions.</span>
            <button
              type="button"
              onClick={() => setMarkerVisibleCount((count) => Math.min(count + TIMELINE_MARKER_WINDOW, visibleMarkers.length))}
              className="min-h-10 rounded border border-bd bg-bg-elev px-2.5 py-2 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Show {Math.min(TIMELINE_MARKER_WINDOW, visibleMarkers.length - renderedMarkers.length)} more
            </button>
          </div>
        )}
        </div>
      </section>
      )}

      {(data.changePoints ?? []).length > 0 && isVisible("shifts") && (
        <section id="shifts" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
          <SectionHeader
            icon={Zap}
            title="Global shifts (context)"
            desc="Population changes that add context; not attribution."
            right={`${(data.changePoints ?? []).length} detected`}
          />
          <div className="card min-w-0 overflow-hidden">
          <div className="border-b border-bd-subtle px-3 py-3 text-[11px] leading-snug text-fg-dim">
            <span className="font-medium text-fg">What this section means.</span> These are two-window outcome shifts (z ≥ 3). Nearby markers add context; no row claims that an adoption caused the shift.
          </div>
          <div className="chart-scroll-well overflow-x-auto pb-2">
            <table className="data-table min-w-[640px]">
              <caption className="sr-only">Global statistical shifts with metric values, z score, and nearby adoption markers shown as context only.</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">Before → after</th>
                  <th scope="col" className="num">z</th>
                  <th scope="col" className="pl-4">Nearby markers (not attribution)</th>
                </tr>
              </thead>
              <tbody>
                {(data.changePoints ?? []).map((cp) => {
                  const lowerIsBetter = cp.metric !== "outcome";
                  const good = lowerIsBetter ? cp.delta < 0 : cp.delta > 0;
                  const fmt = (v: number) => (cp.metric === "costUsd" ? "$" + v.toFixed(2) : cp.metric === "toolErrorRate" ? (v * 100).toFixed(0) + "%" : v.toFixed(2));
                  const metricLabel = cp.metric === "toolErrorRate" ? "tool errors" : cp.metric === "costUsd" ? "cost / session" : "outcome";
                  const metricColor = cp.metric === "toolErrorRate" ? "var(--color-err)" : cp.metric === "costUsd" ? "var(--color-warn)" : "var(--color-accent-soft)";
                  return (
                    <tr key={`${cp.metric}-${cp.at}`}>
                      <td className="mono text-[12px] text-fg-muted tabular-nums">{fmtDate(cp.at)}</td>
                      <td>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
                          style={{ color: metricColor, background: `color-mix(in srgb, ${metricColor} 12%, transparent)` }}
                        >
                          <span className="size-1.5 rounded-full" style={{ background: metricColor }} />
                          {metricLabel}
                        </span>
                      </td>
                      <td className={clsx("num", good ? "text-ok" : "text-err")}>
                        <span className="text-fg-dim">{fmt(cp.before)}</span> → {fmt(cp.after)}
                      </td>
                      <td className="num text-fg-dim">{cp.zScore.toFixed(1)}</td>
                      <td className="pl-4 text-[11px] text-fg-muted">
                        {cp.nearMarkers.length ? cp.nearMarkers.join(" · ") : <span className="text-fg-dim">unattributed — nothing new adopted nearby</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </section>
      )}


        </div>
      </div>
    </div>
  );
}