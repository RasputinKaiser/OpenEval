"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Clock3, Cpu, FolderGit2, Gauge, Layers, RefreshCw, ShieldAlert, Timer } from "lucide-react";
import HarnessPicker from "./HarnessPicker";
import PageHeader from "./PageHeader";
import { SectionHeader, SectionNav } from "./Section";
import { RedactToggle } from "./RedactToggle";
import { useRedactedShow } from "@/lib/use-redaction";
import type { LiveAggregate, LiveSession, TranscriptResult } from "@/lib/live";
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

type LiveClientProps = {
  initialData?: LiveAggregate | null;
  error?: string;
  getTranscript?: (filePath: string, harness?: string) => Promise<TranscriptResult>;
  /** Server timestamp of the RSC scan; lets the client skip the redundant mount poll. */
  scannedAt?: number;
};

type LivePollResponse =
  | (LiveAggregate & { sig?: string; generatedAt?: number })
  | { unchanged: true; sig: string; generatedAt: number };

const HARNESS_STORAGE_KEY = "openeval.live.harness";
const POLL_VISIBLE_MS = 10000;
const POLL_HIDDEN_MS = 30000;

export default function LiveClient({ initialData, error: initialError, getTranscript, scannedAt }: LiveClientProps) {
  const [data, setData] = useState<LiveAggregate | null>(initialData ?? null);
  const [error, setError] = useState<string | undefined>(initialError);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initialData && !initialError ? scannedAt ?? null : null);
  const [selected, setSelected] = useState<LiveSession | null>(null);
  const handleSelectSession = useCallback((s: LiveSession) => setSelected(s), []);
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
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

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
    const poll = async () => {
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
          if ("unchanged" in d && d.unchanged) {
            lastSigRef.current = d.sig;
            setError(undefined);
          } else {
            const next = d as LiveAggregate & { sig?: string };
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
      } finally {
        if (activeController === controller) activeController = null;
        if (!cancelled) {
          setLoading(false);
          const delay = (typeof document !== "undefined" && document.visibilityState !== "visible") ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
          t = setTimeout(poll, delay);
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
    () => selectVisibleSessions(data?.sessions ?? [], { filter, sort, search: debouncedSearch }),
    [data, filter, sort, debouncedSearch]
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

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader
        icon={Activity}
        title="Live sessions"
        subtitle={
          <>
            Live trace sessions from <code className="mono text-xs">{displayText(data.sourceRoots[0] ?? data.sourceLabel, redact, users)}</code>, with usage
            provenance, parser confidence, and copy-safe redaction for local usernames.
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
              <RedactToggle redact={redact} onToggle={() => setRedact((value) => !value)} />
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-md border border-bd bg-bg-elev px-3 py-2 text-xs text-fg-muted hover:text-fg"
              >
                <RefreshCw className="size-4" /> Refresh
              </button>
            </div>
          </div>
        }
      />

      <SectionNav
        sections={[
          { id: "usage", label: "Usage" },
          { id: "quality", label: "Quality" },
          { id: "sessions", label: "Sessions" },
          { id: "intelligence", label: "Intelligence" },
        ]}
        summary={`${data.totalSessions} sessions · ${Math.round(data.avgDataQuality)}% quality`}
      />

      {data.sourceStatus !== "available" && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {displayText(data.sourceMessage ?? "No live trace source is available for this harness.", redact, users)}
        </div>
      )}

      {data.scanWarnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {data.scanWarnings.map((warning) => <div key={warning}>{displayText(warning, redact, users)}</div>)}
        </div>
      )}

      <LiveUsageStrip data={data} />

      <section id="quality" className="scroll-mt-16 mb-6">
        <SectionHeader
          icon={Gauge}
          title="Data quality"
          desc="What the trace actually records — population, model evidence, and parse health"
          right={`${Math.round(data.avgDataQuality)}% avg quality`}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricGroup label="Population">
          <Stat label="Sessions" value={String(data.totalSessions)} icon={Activity} />
          <Stat label="Measured dur" value={`${data.sessionsWithMeasuredDuration}/${data.totalSessions}`} icon={Timer} />
        </MetricGroup>
        <MetricGroup label="Quality">
          <Stat label="Quality" value={`${Math.round(data.avgDataQuality)}%`} icon={Gauge} tone={qualityTone(data.avgDataQuality)} />
          <Stat label={modelEvidenceLabel} value={String(modelEvidenceValue)} icon={Cpu} tone={modelEvidenceTone} />
          <Stat label="Tokens missing" value={String(data.sessionsWithMissingTokens)} icon={Layers} tone={data.sessionsWithMissingTokens ? "warn" : undefined} />
        </MetricGroup>
        <MetricGroup label="Health">
          <Stat label="Tool err rate" value={`${Math.round(toolErrorRate * 100)}%`} icon={AlertTriangle} tone={toolErrorRate ? "err" : undefined} />
          <Stat label="Stale" value={String(staleCount)} icon={Clock3} tone={staleCount ? "warn" : undefined} />
          <Stat label="Malformed" value={String(data.sessionsWithMalformedLines)} icon={ShieldAlert} tone={data.sessionsWithMalformedLines ? "err" : undefined} />
        </MetricGroup>
        </div>
      </section>

      <section id="sessions" className="scroll-mt-16 mb-6">
      <SectionHeader
        icon={FolderGit2}
        title="Sessions"
        desc="Model evidence and every recent session — filter, sort, click for the full drawer"
        right={`${visibleSessions.length}/${data.sessions.length} shown`}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.8fr]">
        <ModelPanel data={data} />
        <SessionTable
          sessions={visibleSessions}
          totalCount={data.sessions.length}
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
      </section>

      <TraceIntelligencePanels data={data} redact={redact} users={users} />

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
          harness={data.sourceHarness}
        />
      )}
    </div>
  );
}
