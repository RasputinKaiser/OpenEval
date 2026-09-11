"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChartSelection } from "@/lib/use-chart-selection";
import { inRange } from "@/lib/chart-analysis";
import { DateRangeControls, SelectionChips } from "./charts/SelectionControls";
import { MetricDistribution } from "./charts/MetricDistribution";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";
import clsx from "clsx";
import { Activity, AlertTriangle, Archive, ChevronDown, Clock3, Cpu, FolderGit2, Gauge, Layers, Radio, RefreshCw, Scale, ShieldAlert, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import HarnessPicker from "./HarnessPicker";
import PageHeader from "./PageHeader";
import { SectionHeader } from "./Section";
import { EvidenceComposition } from "./evidence/EvidenceComposition";
import { SessionFootprint } from "./live/SessionFootprint";
import { ProgressiveSectionNav, sectionVisibilityClass, useProgressiveSection } from "./mobile/ProgressiveSectionNav";
import { RedactToggle } from "./RedactToggle";
import { useRedactedShow } from "@/lib/use-redaction";
import type { LiveAggregateList, LiveSessionDetailResult, LiveSessionListItem, TranscriptResult } from "@/lib/live";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  applyLiveViewState,
  displayText,
  isSessionStale,
  mergeAggregate,
  parseLiveViewState,
  qualityTone,
  selectVisibleSessions,
  sessionKey,
  type FilterMode,
  type SortMode,
} from "./live/live-shared";
import { EmptyCard, ErrorCard, LoadingSkeleton, MetricGroup, Stat, UpdatedIndicator } from "./live/LivePrimitives";
import { LiveUsageStrip } from "./live/LiveUsageStrip";
import { ModelPanel, TraceIntelligencePanels } from "./live/LivePanels";
import { SessionFilters } from "./live/SessionFilters";
import { SessionTable } from "./live/SessionTable";
import { SessionDrawer } from "./live/SessionDrawer";
import { fmtInt } from "@/lib/format";

type LiveClientProps = {
  initialData?: LiveAggregateList | null;
  error?: string;
  getTranscript?: (filePath: string, harness?: string, sessionId?: string) => Promise<TranscriptResult>;
  getSessionDetail?: (filePath: string, harness?: string, sessionId?: string) => Promise<LiveSessionDetailResult>;
  /** Server timestamp of the RSC scan; lets the client skip the redundant mount poll. */
  scannedAt?: number;
};

type LivePollResponse =
  | (LiveAggregateList & { sig?: string; generatedAt?: number })
  | { unchanged: true; sig: string; generatedAt: number };

const HARNESS_STORAGE_KEY = "openeval.live.harness";
const POLL_VISIBLE_MS = 10000;
const POLL_HIDDEN_MS = 30000;
const LIVE_SECTIONS = [
  { id: "usage", label: "Usage", description: "Usage, cost, and throughput in this scan." },
  { id: "quality", label: "Data quality", description: "Coverage, warnings, and parser confidence behind these totals." },
  { id: "sessions", label: "Sessions", description: "Search and inspect individual sessions, failures, and provenance." },
  { id: "intelligence", label: "Patterns", description: "Compare models, tools, and trace patterns in this scan." },
];

export default function LiveClient({ initialData, error: initialError, getTranscript, getSessionDetail, scannedAt }: LiveClientProps) {
  const router = useRouter();
  const [data, setData] = useState<LiveAggregateList | null>(initialData ?? null);
  const [error, setError] = useState<string | undefined>(initialError);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initialData && !initialError ? scannedAt ?? null : null);
  const [selected, setSelected] = useState<LiveSessionListItem | null>(null);
  const handleSelectSession = useCallback((s: LiveSessionListItem) => {
    // Overdrive: when the browser supports View Transitions, open the drawer inside
    // one so the panel crossfades/slides as a single composited moment instead of a
    // two-render pop. Reduced-motion users keep the plain path (CSS disables the
    // transition animation globally).
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (typeof doc.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doc.startViewTransition(() => setSelected(s));
    } else {
      setSelected(s);
    }
  }, []);
  const [selectedHarness, setSelectedHarness] = useState(initialData?.sourceHarness ?? "");
  // Per-instance harvest — no module state, so nothing leaks across SSR
  // requests or component instances.
  const harvestFrom = useMemo(() => {
    const src: unknown[] = [];
    for (const s of data?.sessions ?? []) src.push(s.project, s.path);
    for (const root of data?.sourceRoots ?? []) src.push(root);
    return src;
  }, [data]);
  const { redact, setRedact, users } = useRedactedShow(harvestFrom);
  const { selection: chartSelection, setSelection: setChartSelection, error: chartSelectionError } = useChartSelection();
  const unsupportedChartFilters = Object.keys(chartSelection).filter((key) => key !== "fromMs" && key !== "toMs");
  const [failureFilter, setFailureFilter] = useState<"all" | "errors" | "clear">("all");
  useEffect(() => {
    const read = () => { const value = new URLSearchParams(window.location.search).get("liveTools"); setFailureFilter(value === "errors" || value === "clear" ? value : "all"); };
    read(); window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const setToolFailureFilter = (value: "all" | "errors" | "clear") => {
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete("liveTools"); else url.searchParams.set("liveTools", value);
    window.history.pushState(null, "", url); setFailureFilter(value);
  };
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const { activeSection, selectSection, isVisible } = useProgressiveSection(LIVE_SECTIONS, "all");

  const lastSigRef = useRef("");
  // The RSC just scanned; skip the immediate mount poll when initialData is
  // younger than the visible poll interval (avoids two full scans on load).
  const skipMountPollRef = useRef(
    Boolean(initialData) && !initialError && typeof scannedAt === "number" && Date.now() - scannedAt < POLL_VISIBLE_MS
  );

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const urlHarness = url.searchParams.get("harness");
      const storedHarness = window.localStorage.getItem(HARNESS_STORAGE_KEY);
      if (urlHarness) setSelectedHarness(urlHarness);
      else if (storedHarness) setSelectedHarness(storedHarness);
      // Restore filter/sort/search from the URL so views are shareable.
      const view = parseLiveViewState(url.searchParams);
      setFilter(view.filter);
      setSort(view.sort);
      setSearch(view.search);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(HARNESS_STORAGE_KEY, selectedHarness);
      const url = new URL(window.location.href);
      if (!selectedHarness) url.searchParams.delete("harness");
      else url.searchParams.set("harness", selectedHarness);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }, [selectedHarness]);

  // Mirror filter/sort/search into the URL (defaults omitted) so the current
  // view can be shared or restored on reload. The first run is skipped: it
  // fires in the same commit as the URL-restore effect above but with the
  // default-state closure, and writing then would momentarily strip the
  // shared params before restore kicks in.
  const skipFirstViewSyncRef = useRef(true);
  useEffect(() => {
    if (skipFirstViewSyncRef.current) {
      skipFirstViewSyncRef.current = false;
      return;
    }
    try {
      const url = new URL(window.location.href);
      applyLiveViewState(url.searchParams, { filter, sort, search: debouncedSearch });
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }, [filter, sort, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    let activeController: AbortController | null = null;
    let inFlight = false;
    let consecutiveFailures = 0;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      try {
        const params = new URLSearchParams();
        if (selectedHarness) params.set("harness", selectedHarness);
        // The RSC render honors ?limit=; the poll must forward it too, or the
        // first poll silently replaces the page with the default-limit scan.
        try {
          const limit = new URL(window.location.href).searchParams.get("limit");
          if (limit) params.set("limit", limit);
        } catch {}
        // The server compares this against the fresh scan's signature and
        // answers {unchanged:true} instead of the full aggregate on a match.
        if (lastSigRef.current) params.set("sig", lastSigRef.current);
        const response = await fetch(`/api/live${params.size ? `?${params}` : ""}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Live poll failed: HTTP ${response.status}`);
        const d = (await response.json()) as LivePollResponse;
        if (!cancelled) {
          consecutiveFailures = 0;
          if ("unchanged" in d && d.unchanged) {
            lastSigRef.current = d.sig;
            setError(undefined);
          } else {
            const next = d as LiveAggregateList & { sig?: string };
            lastSigRef.current = next.sig ?? "";
            setData((prev) => mergeAggregate(prev, next));
            // Any parsed 200 means polling recovered — clearing must not be
            // gated on session count, or the stale indicator sticks forever
            // on an empty-but-healthy source.
            setError(undefined);
          }
          setUpdatedAt(Date.now());
        }
      } catch (e) {
        // Keep showing the last good data; the header indicator flips to an
        // explicit stale state instead of silently looking fresh.
        if (!cancelled && !(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : String(e));
        }
        // Exponential backoff so a failing endpoint isn't hammered every cycle;
        // reset to the normal cadence on the next successful poll.
        consecutiveFailures += 1;
      } finally {
        inFlight = false;
        if (activeController === controller) activeController = null;
        if (!cancelled) {
          setLoading(false);
          const base = (typeof document !== "undefined" && document.visibilityState !== "visible") ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
          const backoff = Math.min(60_000, base * Math.pow(2, Math.min(consecutiveFailures, 4)));
          t = setTimeout(poll, backoff);
        }
      }
    };
    function onVis() { if (document.visibilityState === "visible" && !cancelled) { if (t) clearTimeout(t); poll(); } }
    document.addEventListener("visibilitychange", onVis);
    if (skipMountPollRef.current) {
      skipMountPollRef.current = false;
      const age = typeof scannedAt === "number" ? Date.now() - scannedAt : POLL_VISIBLE_MS;
      t = setTimeout(poll, Math.max(1000, POLL_VISIBLE_MS - age));
    } else {
      poll();
    }
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      activeController?.abort();
      clearTimeout(t);
    };
  }, [selectedHarness, scannedAt]);

  // Re-point the open drawer at the freshest object for its session: polls
  // hand changed sessions NEW references (mergeAggregate), so holding the
  // click-time reference would freeze the drawer while the row behind it
  // keeps updating.
  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      const fresh = data?.sessions.find((s) => sessionKey(s) === sessionKey(current));
      return fresh && fresh !== current ? fresh : current;
    });
  }, [data]);

  const visibleSessions = useMemo(
    () => selectVisibleSessions((data?.sessions ?? []).filter((session) => ((chartSelection.fromMs === undefined && chartSelection.toMs === undefined) || inRange(session.startedAt, chartSelection.fromMs, chartSelection.toMs)) && (failureFilter === "all" || (failureFilter === "errors" ? session.toolErrors > 0 : session.toolErrors === 0))), { filter, sort, search: debouncedSearch }),
    [data, filter, sort, debouncedSearch, chartSelection.fromMs, chartSelection.toMs, failureFilter]
  );

  // Drawer prev/next moves through the currently visible (filtered + sorted)
  // order. Matched by key, not reference: polls can replace the selected
  // session object while the drawer is open.
  const selectedIndex = selected ? visibleSessions.findIndex((s) => sessionKey(s) === sessionKey(selected)) : -1;
  const navigateDrawer = useCallback((delta: 1 | -1) => {
    setSelected((current) => {
      if (!current) return current;
      const list = visibleSessions;
      const index = list.findIndex((s) => sessionKey(s) === sessionKey(current));
      if (index === -1) return current;
      return list[index + delta] ?? current;
    });
  }, [visibleSessions]);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return error ? <ErrorCard message={error} /> : <EmptyCard warnings={[]} />;

  const toolErrorRate = data.totalToolCalls > 0 ? data.totalToolErrors / data.totalToolCalls : 0;
  // Server staleSessions is stamped at scan time and freezes under the
  // unchanged-sig poll shortcut; derive it from lastEventAt instead.
  const staleCount = data.sessions.filter((s) => isSessionStale(s)).length;
  const modelEvidenceLabel = data.sessionsWithMissingModel ? "Unknown model" : "Inferred model";
  const modelEvidenceValue = data.sessionsWithMissingModel ? data.sessionsWithMissingModel : data.sessionsWithInferredModel;
  const modelEvidenceTone = data.sessionsWithMissingModel ? "warn" : undefined;
  // Compatibility fallback for a stale client bundle during local HMR. Fresh
  // server payloads always include the explicit scan-population boundary.
  const scanCoverage = data.scanCoverage ?? {
    requestedLimit: data.totalSessions,
    discoveredFiles: data.totalSessions,
    scannedFiles: data.totalSessions,
    parsedFiles: data.totalSessions,
    droppedFiles: 0,
    unscannedFiles: 0,
    archivedSessionsAdded: 0,
    truncated: false,
    partial: false,
  };
  const hasLiveCoverageNotes = data.sourceStatus !== "available" || data.scanWarnings.length > 0 || scanCoverage.truncated || scanCoverage.partial;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader
        icon={Radio}
        title="Live sessions"
        subtitle={
          <>
            Inspect recent trace sessions from <code className="mono text-xs">{displayText(data.sourceRoots[0] ?? data.sourceLabel, redact, users)}</code>. Usage,
            parser coverage, and local-path redaction are shown when available.
          </>
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-80">
            <HarnessPicker value={selectedHarness || undefined} onChange={(harness) => {
              setSelected(null);
              setSelectedHarness(harness || "");
            }} />
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <UpdatedIndicator updatedAt={updatedAt} staleError={data ? error : undefined} />
              <RedactToggle redact={redact} onToggle={() => setRedact((value) => !value)} compact />
              <button
                type="button"
                onClick={(e) => {
                  // Soft refresh: re-fetch server components in place (router.refresh)
                  // so drawer position and scroll survive the update. The spin glyph
                  // covers the fetch window; the event is claimed so it can't bubble.
                  const icon = e.currentTarget.querySelector("svg");
                  if (icon) icon.classList.add("anim-spin-once");
                  window.setTimeout(() => icon?.classList.remove("anim-spin-once"), 600);
                  router.refresh();
                }}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-bd bg-bg-elev px-3 py-2 text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RefreshCw className="size-4" /> Refresh
              </button>
            </div>
          </div>
        }
      />

      <ProgressiveSectionNav
        sections={LIVE_SECTIONS}
        activeSection={activeSection}
        onSelect={selectSection}
        summary={`${fmtInt(data.totalSessions)} parsed slice · ${fmtInt(scanCoverage.scannedFiles)}/${fmtInt(scanCoverage.discoveredFiles)} files scanned`}
      />

      {hasLiveCoverageNotes && (
        <div role={data.sourceStatus !== "available" ? "alert" : "status"} className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          <div className="font-medium">{data.sourceStatus !== "available" ? "Live source needs attention" : "Live scan notes"}</div>
          {(() => {
            // Depth-boundary warnings repeat the same shape per directory; 30+ identical
            // lines drown the signal. Summarize the count + group by top-level folder in
            // a collapsed list; other warnings (source attention, coverage) stay inline —
            // those are actionable, the boundary noise is not.
            const boundary = data.scanWarnings.filter((w) => w.includes("Scan depth boundary"));
            const other = data.scanWarnings.filter((w) => !w.includes("Scan depth boundary"));
            const byDir = new Map<string, number>();
            for (const w of boundary) {
              const match = w.match(/Scan depth boundary at ([^;]+);/);
              if (match) {
                const parts = match[1].split("/");
                // key = the last stable segment group (e.g. browser-profile, cache/browser-use, checkpoints)
                const key = parts.slice(0, parts.length - 1).slice(-2).join("/");
                byDir.set(key, (byDir.get(key) ?? 0) + 1);
              }
            }
            return (
              <>
                {data.sourceStatus !== "available" && (
                  <ul className="mt-1 space-y-0.5 text-[11px] leading-4 text-fg-muted">
                    <li>{displayText(data.sourceMessage ?? "No live trace source is available for this harness.", redact, users)}</li>
                  </ul>
                )}
                {other.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] leading-4 text-fg-muted">
                    {other.map((warning) => <li key={warning}>{displayText(warning, redact, users)}</li>)}
                  </ul>
                )}
                {boundary.length > 0 && (
                  <details className="evidence-accordion group mt-1 text-[11px] leading-4">
                    <summary className="inline-flex min-h-6 cursor-pointer select-none items-center gap-1 rounded text-fg-muted transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                      {boundary.length} scan-depth notes (subtrees could not be proven empty)
                      <ChevronDown aria-hidden className="size-3 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {[...byDir.entries()].map(([dir, count]) => (
                        <li key={dir}>{displayText(dir, redact, users)} — {count} {count === 1 ? "path" : "paths"}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {(scanCoverage.truncated || scanCoverage.partial) && (
                  <p className="mt-1 text-[11px] leading-4 text-fg-muted">
                    This view is a partial slice: scanned <span className="mono tabular-nums">{scanCoverage.scannedFiles}</span> of{" "}
                    <span className="mono tabular-nums">{scanCoverage.discoveredFiles}</span> discovered files and parsed{" "}
                    <span className="mono tabular-nums">{scanCoverage.parsedFiles}</span> sessions
                    {scanCoverage.droppedFiles > 0 && <> ({scanCoverage.droppedFiles} non-session files dropped)</>}.
                    {scanCoverage.truncated && <> <span className="mono tabular-nums">{scanCoverage.unscannedFiles}</span> older files were not scanned.</>}{" "}
                    Totals below describe only the parsed evidence in this slice, not complete history.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {isVisible("usage") && <div className="observe-section"><LiveUsageStrip data={data} onExploreDay={(fromMs, toMs) => { setChartSelection({ fromMs, toMs }); selectSection("sessions"); }} /></div>}

      {isVisible("quality") && <section id="quality" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
        <SectionHeader
          icon={Gauge}
          title="Data quality"
          desc="What the trace actually records — population, model evidence, and parse health"
          right={`${fmtInt(data.totalSessions)} sessions`}
        />
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        <MetricGroup label="Population">
          <Stat label="Parsed slice" value={String(data.totalSessions)} icon={Activity} />
          <Stat label="Files scanned" value={`${scanCoverage.scannedFiles}/${scanCoverage.discoveredFiles}`} icon={FolderGit2} />
          <Stat label="Dropped" value={String(scanCoverage.droppedFiles)} icon={Layers} tone={scanCoverage.droppedFiles ? "warn" : undefined} />
          <Stat label="Measured dur" value={`${data.sessionsWithMeasuredDuration}/${data.totalSessions}`} icon={Timer} />
          <Stat label="Child agents" value={String(data.subagentSessions)} icon={Layers} />
        </MetricGroup>
        <MetricGroup label="Quality">
          <Stat label="Quality" value={`${Math.round(data.avgDataQuality)}%`} icon={Gauge} tone={qualityTone(data.avgDataQuality)} />
          <Stat label={modelEvidenceLabel} value={String(modelEvidenceValue)} icon={Cpu} tone={modelEvidenceTone} />
          <Stat label="Cost inferred" value={fmtInt(data.sessionsWithInferredCost)} icon={Scale} tone={undefined} />
          <Stat label="Tokens missing" value={String(data.sessionsWithMissingTokens)} icon={Layers} tone={data.sessionsWithMissingTokens ? "warn" : undefined} />
        </MetricGroup>
        <MetricGroup label="Health">
          <Stat label="Tool err rate" value={`${Math.round(toolErrorRate * 100)}%`} icon={AlertTriangle} tone={toolErrorRate ? "err" : undefined} />
          <Stat label="Inactive >12h" value={`${fmtInt(staleCount)} of ${fmtInt(data.totalSessions)}`} icon={Clock3} tone={staleCount ? "warn" : undefined} />
          <Stat label="Malformed" value={String(data.sessionsWithMalformedLines)} icon={ShieldAlert} tone={data.sessionsWithMalformedLines ? "err" : undefined} />
          <Stat label="Archived" value={fmtInt(data.archivedSessions)} icon={Archive} tone={undefined} />
        </MetricGroup>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg border border-bd-subtle bg-bg-subtle/30 p-4 md:grid-cols-2">
          <EvidenceComposition
            label="Model identity"
            total={data.totalSessions}
            segments={[
              { label: "measured", value: data.sessionsWithMeasuredModel, tone: "measured" },
              { label: "inferred", value: data.sessionsWithInferredModel, tone: "inferred" },
              { label: "unavailable", value: Math.max(0, data.totalSessions - data.sessionsWithMeasuredModel - data.sessionsWithInferredModel), tone: "missing" },
            ]}
          />
          <EvidenceComposition
            label="Duration"
            total={data.totalSessions}
            segments={[
              { label: "measured", value: data.sessionsWithMeasuredDuration, tone: "measured" },
              { label: "inferred", value: data.sessionsWithInferredDuration, tone: "inferred" },
              { label: "unavailable", value: Math.max(0, data.totalSessions - data.sessionsWithMeasuredDuration - data.sessionsWithInferredDuration), tone: "missing" },
            ]}
          />
          <EvidenceComposition
            label="Token usage"
            total={data.totalSessions}
            segments={[
              { label: "measured", value: data.usageSummary.sessionsWithMeasuredUsage, tone: "measured" },
              { label: "unavailable", value: Math.max(0, data.totalSessions - data.usageSummary.sessionsWithMeasuredUsage), tone: "missing" },
            ]}
          />
          <EvidenceComposition
            label="Cost"
            total={data.totalSessions}
            segments={[
              { label: "measured", value: data.usageSummary.sessionsWithMeasuredCost, tone: "measured" },
              { label: "inferred", value: data.sessionsWithInferredCost, tone: "inferred" },
              { label: "unavailable", value: Math.max(0, data.totalSessions - data.usageSummary.sessionsWithMeasuredCost - data.sessionsWithInferredCost), tone: "missing" },
            ]}
            note="Measured and inferred remain separate; priced coverage is never relabeled as recorded spend."
          />
        </div>
        {/* Where does the money concentrate? One dot per session on a log-cost axis. */}
        {data.sessions.length > 0 && (
          <div className="mt-3 rounded-lg border border-bd-subtle bg-bg-subtle/30 p-4">
            <SessionFootprint sessions={data.sessions.map((s) => ({ sessionId: s.sessionId, costUsd: s.costUsd, durationMs: s.durationMs, dataQuality: s.dataQuality, isError: s.isError }))} total={data.totalSessions} />
          </div>
        )}
      </section>}

      {isVisible("intelligence") && <div className="observe-section"><TraceIntelligencePanels data={data} redact={redact} users={users} /></div>}

      {isVisible("sessions") && <section id="sessions" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
      <div className="mb-4 space-y-3">
        {(chartSelectionError || unsupportedChartFilters.length > 0) && <p role="alert" className="text-xs text-warn">{chartSelectionError ?? "Live session charts support date filters only; the other URL filters are not applied."} <button type="button" className="analysis-control" onClick={() => setChartSelection({ fromMs: chartSelection.fromMs, toMs: chartSelection.toMs })}>Clear unsupported filters</button></p>}
        <DateRangeControls selection={{ fromMs: chartSelection.fromMs, toMs: chartSelection.toMs }} onChange={setChartSelection} />
        <SelectionChips selection={{ fromMs: chartSelection.fromMs, toMs: chartSelection.toMs }} onChange={setChartSelection} />
        <p className="text-xs text-fg-muted">Date filters apply to session start times in this scanned slice. Usage totals above retain their stated scan scope.</p>
        <ChartFrame title="Tool failure distribution" description="Sessions with reported tool failures in the selected time range. Selecting a bar reveals the evidence filter.">
          <SelectableBars rows={[
            {id:"errors",label:"With tool failures",value:(data.sessions ?? []).filter((s) => ((chartSelection.fromMs === undefined && chartSelection.toMs === undefined) || inRange(s.startedAt, chartSelection.fromMs, chartSelection.toMs)) && s.toolErrors > 0).length,tone:"err"},
            {id:"clear",label:"No reported tool failures",value:(data.sessions ?? []).filter((s) => ((chartSelection.fromMs === undefined && chartSelection.toMs === undefined) || inRange(s.startedAt, chartSelection.fromMs, chartSelection.toMs)) && s.toolErrors === 0).length,tone:"accent"}
          ]} onExplore={(id) => setToolFailureFilter(id === "errors" ? "errors" : "clear")} />
          {failureFilter !== "all" && <button type="button" className="analysis-control mt-2" onClick={() => setToolFailureFilter("all")}>Clear {failureFilter === "errors" ? "with failures" : "no reported failures"} filter</button>}
        </ChartFrame>
      </div>
      <details className="card p-4 mb-4"><summary className="cursor-pointer text-sm font-medium">Session distributions · {visibleSessions.length} filtered sessions</summary><div className="grid md:grid-cols-2 gap-3 mt-3 analysis-reveal">
        <MetricDistribution title="Session duration" values={visibleSessions.map(session => ["measured", "inferred"].includes(session.metricSources.duration) ? session.durationMs : null)} format={value => `${(value / 60000).toFixed(1)}m`} unit="Minutes · measured and inferred" description="Current session filters apply. An active session duration can still grow." />
        <MetricDistribution title="Session cost" values={visibleSessions.map(session => ["measured", "inferred"].includes(session.metricSources.cost) ? session.costUsd : null)} format={value => `$${value.toFixed(3)}`} unit="USD · measured and inferred" description="Missing and malformed cost records are excluded. Zero recorded costs remain visible." />
      </div></details>
      <SectionHeader
        icon={FolderGit2}
        title="Sessions"
        desc="Model evidence and every recent session — filter, sort, click for the full drawer"
        right={`${visibleSessions.length}/${data.sessions.length} shown`}
      />
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)]">
        <ModelPanel data={data} />
        <SessionTable
          sessions={visibleSessions}
          totalCount={data.sessions.length}
          viewKey={`${filter}\u0000${sort}\u0000${debouncedSearch}`}
          redact={redact}
          users={users}
          onSelect={handleSelectSession}
          controls={
            <SessionFilters
              filter={filter}
              sort={sort}
              search={search}
              onFilterChange={setFilter}
              onSortChange={setSort}
              onSearchChange={setSearch}
            />
          }
        />
      </div>
      </section>}

      {selected && (
        <SessionDrawer
          session={selected}
          redact={redact}
          users={users}
          onClose={() => setSelected(null)}
          onNavigate={navigateDrawer}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex !== -1 && selectedIndex < visibleSessions.length - 1}
          getTranscript={getTranscript}
          getSessionDetail={getSessionDetail}
          harness={data.sourceHarness}
        />
      )}
    </div>
  );
}
