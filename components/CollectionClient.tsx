"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Boxes, RefreshCw, HelpCircle, AlertTriangle, Activity, Search, DatabaseZap,
  Layers, Coins, Hammer, TrendingUp, CalendarClock, Cpu, Wrench, HardDrive, History,
  ArrowDownWideNarrow, Filter, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import PageHeader from "./PageHeader";
import { SectionHeader, SectionNav } from "./Section";
import { RedactToggle } from "./RedactToggle";
import { compactDisplayPath } from "@/lib/redaction";
import { useRedactedShow } from "@/lib/use-redaction";
import { DAYS, fmtNum, fmtNumFull, fmtUsd, fmtUsdFull, fmtRel, fmtDuration } from "@/lib/format";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import type { RollupReport } from "@/lib/collection/rollup";
import type { FtsHit } from "@/lib/live-cache";
import { WeeklyUsageChart, ActivityHeatmap, ToolHealthList } from "./CollectionCharts";


function StatusPill({ status }: { status: "present" | "empty" | "absent" }) {
  const tone = status === "present" ? "bg-ok/15 text-ok" : status === "empty" ? "bg-warn/15 text-warn" : "bg-bg-elev text-fg-dim";
  return <span className={clsx("rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider", tone)}>{status}</span>;
}

/** One cell inside a StatGroup — fixed two-line body so groups align. */
function StatCell({ label, value, sub, title, tone }: { label: string; value: ReactNode; sub?: ReactNode; title?: string; tone?: string }) {
  return (
    <div className="px-3 py-2.5 min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted truncate">{label}</div>
      <div className={clsx("text-base mono font-semibold tabular-nums mt-0.5 truncate", tone)}>{value}</div>
      <div className="text-[11px] text-fg-dim mono truncate">{sub ?? " "}</div>
    </div>
  );
}

function StatGroup({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-3 pt-2 pb-1.5 text-[10px] uppercase tracking-wider text-fg-dim flex items-center gap-1.5 border-b border-bd-subtle">
        <Icon className="size-3" /> {label}
      </div>
      <div className="grid grid-cols-3 divide-x divide-bd-subtle">{children}</div>
    </div>
  );
}

/** Day-part / weekday split derived from the session-start heatmap. */
function RhythmPanel({ heatmap }: { heatmap: number[][] }) {
  const dayTotals = heatmap.map((row) => row.reduce((a, b) => a + b, 0));
  const total = Math.max(1, dayTotals.reduce((a, b) => a + b, 0));
  const hourTotals = Array.from({ length: 24 }, (_, h) => heatmap.reduce((a, row) => a + row[h], 0));

  const parts = [
    { label: "Morning", range: "06–12", n: hourTotals.slice(6, 12).reduce((a, b) => a + b, 0) },
    { label: "Afternoon", range: "12–18", n: hourTotals.slice(12, 18).reduce((a, b) => a + b, 0) },
    { label: "Evening", range: "18–24", n: hourTotals.slice(18, 24).reduce((a, b) => a + b, 0) },
    { label: "Night", range: "00–06", n: hourTotals.slice(0, 6).reduce((a, b) => a + b, 0) },
  ];
  const maxPart = Math.max(1, ...parts.map((p) => p.n));
  const peakDay = dayTotals.indexOf(Math.max(...dayTotals));
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
  const weekendPct = ((dayTotals[5] + dayTotals[6]) / total) * 100;

  return (
    <div className="card p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-fg-muted mb-2.5">Day parts</h3>
      <div className="space-y-2">
        {parts.map((p) => (
          <div key={p.label} title={`${fmtNumFull(p.n)} sessions started ${p.range}`}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-fg-muted">
                {p.label} <span className="text-fg-dim text-[10px] mono">{p.range}</span>
              </span>
              <span className="mono tabular-nums text-[11px]">
                {fmtNum(p.n)} <span className="text-fg-dim">· {((p.n / total) * 100).toFixed(0)}%</span>
              </span>
            </div>
            <div
              className="h-[3px] rounded-full mt-1"
              style={{
                width: `${Math.max(2, (p.n / maxPart) * 100)}%`,
                background: "color-mix(in srgb, var(--color-accent) 50%, transparent)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2.5 border-t border-bd-subtle space-y-1 text-[11px]">
        <div className="flex justify-between gap-2"><span className="text-fg-dim">Busiest day</span><span className="mono tabular-nums">{DAYS[peakDay]} · {((dayTotals[peakDay] / total) * 100).toFixed(0)}%</span></div>
        <div className="flex justify-between gap-2"><span className="text-fg-dim">Peak hour</span><span className="mono tabular-nums">{String(peakHour).padStart(2, "0")}:00</span></div>
        <div className="flex justify-between gap-2"><span className="text-fg-dim">Weekend share</span><span className="mono tabular-nums">{weekendPct.toFixed(0)}%</span></div>
      </div>
    </div>
  );
}

/** Thin share bar + percentage, right-aligned — for table share columns. */
function ShareBar({ frac }: { frac: number }) {
  const pct = Math.max(0, Math.min(100, frac * 100));
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="h-[3px] w-14 rounded-full bg-bg-elev overflow-hidden shrink-0">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%`, background: "color-mix(in srgb, var(--color-accent) 55%, transparent)" }} />
      </div>
      <span className="text-fg-dim text-[10px] tabular-nums w-8 text-right">{pct < 1 && pct > 0 ? "<1" : pct.toFixed(0)}%</span>
    </div>
  );
}

function PricingEvidence({ model }: { model: AllSourcesResult["byModel"][number] }) {
  const kinds = [
    model.measuredCostSessions > 0 ? "recorded" : null,
    model.allocatedCostSessions > 0 ? "allocated" : null,
    model.listedRateSessions > 0 ? "listed rate" : null,
    model.familyRateSessions > 0 ? "family map" : null,
    model.fallbackRateSessions > 0 ? "fallback" : null,
  ].filter(Boolean) as string[];
  const label = kinds.length === 0 ? "unpriced" : kinds.length === 1 ? kinds[0] : "mixed rates";
  const tone = model.fallbackRateSessions > 0
    ? "text-err"
    : model.familyRateSessions > 0
      ? "text-warn"
      : model.pricedSessions > 0
        ? "text-ok"
        : "text-fg-dim";
  const title = [
    `${fmtNumFull(model.pricedSessions)}/${fmtNumFull(model.sessions)} sessions have a dollar estimate`,
    `${fmtNumFull(model.measuredCostSessions)} recorded costs`,
    `${fmtNumFull(model.allocatedCostSessions)} mixed-model shares allocated from recorded session totals`,
    `${fmtNumFull(model.listedRateSessions)} listed-rate estimates`,
    `${fmtNumFull(model.familyRateSessions)} family-mapped estimates`,
    `${fmtNumFull(model.fallbackRateSessions)} fallback estimates`,
    `${fmtNumFull(model.inferredModelSessions)} sessions have an inferred model id`,
  ].join(" · ");
  return <span className={clsx("text-[9px] uppercase tracking-wide", tone)} title={title}>{label}</span>;
}

/** Compact labeled <select> pill — mirrors the LiveClient sort/filter pills. */
function SelectPill({ icon: Icon, value, onChange, options }: { icon: LucideIcon; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-bd bg-bg-elev px-2 py-1.5 text-xs text-fg-muted">
      <Icon className="size-3.5" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs text-fg outline-none max-w-[160px]"
      >
        {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
      </select>
    </label>
  );
}

type SessionSort = "recent" | "tokens" | "duration" | "tools";
const LOAD_STEP = 160;
const MAX_LIMIT = 10_000;

/**
 * Self-ticking relative label, isolated so the 30s tick re-renders only this
 * span — not the whole (potentially 10k-row) page. Starts at the payload's own
 * reference time so server and client render identically, then a client effect
 * switches to wall-clock.
 */
function ScannedAgo({ generatedAtMs }: { generatedAtMs: number }) {
  const [nowMs, setNowMs] = useState(generatedAtMs);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [generatedAtMs]);
  return (
    <span
      className="text-[11px] text-fg-dim tabular-nums whitespace-nowrap"
      title={`Scan generated ${new Date(generatedAtMs).toISOString()}`}
    >
      scanned {fmtRel(generatedAtMs, nowMs)}
    </span>
  );
}

export default function CollectionClient({ initialData, error, initialQuery, rollup }: { initialData: AllSourcesResult; error?: string; initialQuery?: string; rollup?: RollupReport }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(error);
  const [q, setQ] = useState(initialQuery ?? "");
  const [hits, setHits] = useState<FtsHit[] | null>(null);
  const [sessionSort, setSessionSort] = useState<SessionSort>("recent");
  const [harnessFilter, setHarnessFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  // The scanner keeps only the newest ~100 sessions per source, so a higher
  // limit may return nothing new even while totalParsedSessions is larger.
  // Once a load-more round adds no rows, stop offering it.
  const [listExhausted, setListExhausted] = useState(false);
  const ranInitial = useRef(false);

  // A ?q= handoff (e.g. from the dashboard search box) runs immediately.
  useEffect(() => {
    if (initialQuery && !ranInitial.current) {
      ranInitial.current = true;
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  const [searching, setSearching] = useState(false);
  const [indexInfo, setIndexInfo] = useState<{ indexedFiles: number; totalFiles: number } | null>(null);
  const [indexing, setIndexing] = useState(false);

  // Harvest corpus spans BOTH the session list and any search hits — hits come
  // from the full-history FTS index, whose sessions may predate the recent list.
  const harvestFrom = useMemo(
    () => [
      ...data.sessions.flatMap((s) => [s.project, s.path]),
      ...(hits ?? []).flatMap((h) => [h.project, h.file]),
    ],
    [data.sessions, hits],
  );
  const { redact, setRedact, show } = useRedactedShow(harvestFrom);

  async function runSearch(query: string) {
    if (!query.trim()) { setHits(null); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/collection/search?q=${encodeURIComponent(query)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setHits(d.hits);
      setIndexInfo(d.index);
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function buildIndex() {
    setIndexing(true);
    try {
      let remaining = 1;
      while (remaining > 0) {
        const res = await fetch("/api/collection/search/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max: 25 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        remaining = d.remaining;
        setIndexInfo({ indexedFiles: d.total - d.remaining, totalFiles: d.total });
      }
      if (q.trim()) await runSearch(q);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  async function fetchCollection(limit: number, busy: (v: boolean) => void): Promise<AllSourcesResult | null> {
    busy(true);
    try {
      const res = await fetch(`/api/collection?limit=${Math.min(MAX_LIMIT, Math.max(1, limit))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as AllSourcesResult;
      setData(next);
      setErr(undefined);
      return next;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      busy(false);
    }
  }

  // Rescan keeps however many rows are already loaded instead of snapping back to 80.
  async function refresh() {
    const next = await fetchCollection(Math.max(80, data.sessions.length), setLoading);
    if (next && next.sessions.length > data.sessions.length) setListExhausted(false);
  }

  async function loadMore() {
    const prevLen = data.sessions.length;
    const next = await fetchCollection(prevLen + LOAD_STEP, setLoadingMore);
    if (next) setListExhausted(next.sessions.length <= prevLen);
  }

  const models = data.byModel ?? [];
  const tools = data.byTool ?? [];

  const harnessOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of data.sessions) if (!seen.has(s.sourceId)) seen.set(s.sourceId, s.sourceLabel);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.sessions]);

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const s of data.sessions) seen.add(s.model ?? "unknown");
    return [...seen].sort();
  }, [data.sessions]);

  const visibleSessions = useMemo(() => {
    let list = data.sessions;
    if (harnessFilter !== "all") list = list.filter((s) => s.sourceId === harnessFilter);
    if (modelFilter !== "all") list = list.filter((s) => (s.model ?? "unknown") === modelFilter);
    // The payload already arrives sorted by lastEventAt desc, so "recent"
    // needs no re-sort (and no copy — the branches below never mutate `list`).
    if (sessionSort === "recent") return list;
    const sorted = [...list];
    switch (sessionSort) {
      case "tokens":
        sorted.sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
        break;
      case "duration":
        sorted.sort((a, b) => b.durationMs - a.durationMs);
        break;
      default:
        sorted.sort((a, b) => b.toolCalls - a.toolCalls || b.toolErrors - a.toolErrors);
    }
    return sorted;
  }, [data.sessions, harnessFilter, modelFilter, sessionSort]);

  const sessionsFiltered = harnessFilter !== "all" || modelFilter !== "all";
  const moreAvailable = !listExhausted && data.sessions.length < data.totalParsedSessions;
  const loadedLabel = `${fmtNumFull(data.sessions.length)} of ${fmtNumFull(data.totalParsedSessions)} loaded`;
  const hm = rollup?.heatmap ?? [];
  const hasHeatmap = hm.some((row) => row.some((v) => v > 0));
  const hasWeekly = !!rollup && rollup.weekly.some((w) => w.sessions > 0);
  const hasModels = models.length > 0;
  const hasTools = tools.length > 0;

  const sections = useMemo(() => [
    { id: "overview", label: "Overview" },
    ...(hasWeekly ? [{ id: "usage", label: "Usage" }] : []),
    ...(hasHeatmap ? [{ id: "rhythm", label: "Rhythm" }] : []),
    ...(hasModels ? [{ id: "models", label: "Models" }] : []),
    ...(hasTools ? [{ id: "tools", label: "Tools" }] : []),
    { id: "harnesses", label: "Harnesses" },
    { id: "sessions", label: "Sessions" },
  ], [hasWeekly, hasHeatmap, hasModels, hasTools]);

  const ioTokens = data.totalInputTokens + data.totalOutputTokens;
  const cacheRead = data.totalCacheReadTokens ?? 0;
  const cacheMult = ioTokens > 0 ? cacheRead / ioTokens : 0;
  const toolErrTotal = models.reduce((a, m) => a + m.toolErrors, 0);
  const toolErrPct = data.totalToolCalls > 0 ? (toolErrTotal / data.totalToolCalls) * 100 : 0;
  const pricingCoverage = data.totalParsedSessions > 0 ? data.totalPricedSessions / data.totalParsedSessions : 0;
  const tilde = data.anyEstimatedCost ? "~" : "";

  let busiest: { d: number; h: number; v: number } | null = null;
  for (let d = 0; d < hm.length; d++) {
    for (let h = 0; h < 24; h++) {
      if (!busiest || hm[d][h] > busiest.v) busiest = { d, h, v: hm[d][h] };
    }
  }

  const totalModelCost = models.reduce((a, m) => a + m.costUsd, 0);
  const totalModelSessions = Math.max(1, models.reduce((a, m) => a + m.sessions, 0));

  const projectMax = Math.max(1e-9, ...(rollup?.byProject ?? []).map((p) => p.costUsd));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        icon={Boxes}
        title="Collection"
        subtitle="Live & archived transcripts discovered across every agent harness on this machine. Archived sessions outlive their pruned files."
        actions={
          <>
            <ScannedAgo generatedAtMs={data.generatedAtMs} />
            <RedactToggle redact={redact} onToggle={() => setRedact((v) => !v)} />
            <Link
              href="/collection/timeline"
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors"
            >
              <Activity className="size-3.5" /> Timeline &amp; Impact
            </Link>
            <button
              onClick={refresh}
              disabled={loading || loadingMore}
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} /> Rescan
            </button>
          </>
        }
      />

      <SectionNav
        sections={sections}
        summary={`${fmtNum(data.totalParsedSessions)} sessions · ${tilde}${fmtUsd(data.totalCostUsd)} API eq.`}
      />

      {err && (
        <div className="mb-4 rounded-lg border border-err/40 bg-err/10 p-3 flex items-start gap-2.5" role="alert">
          <AlertTriangle className="size-4 text-err shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-err">Collection scan failed</div>
            <div className="text-[12px] text-fg-muted mt-0.5 break-words">
              {err} — the stats below may be stale or empty. Use Rescan to retry.
            </div>
          </div>
        </div>
      )}

      <section id="overview" className="scroll-mt-16 mb-6">
        <div className="stagger-grid grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatGroup icon={Layers} label="Inventory">
            <StatCell label="Sources" value={String(data.presentSources)} sub={`of ${data.sources.length} known`} />
            <StatCell label="Files" value={fmtNum(data.totalFiles)} title={`${fmtNumFull(data.totalFiles)} session files on disk`} />
            <StatCell
              label="Sessions"
              value={fmtNum(data.totalParsedSessions)}
              title={fmtNumFull(data.totalParsedSessions)}
              sub={data.totalArchivedSessions > 0 ? `incl. ${fmtNum(data.totalArchivedSessions)} archived` : undefined}
            />
          </StatGroup>

          <StatGroup icon={Coins} label="API equivalent">
            <StatCell
              label="List estimate"
              value={tilde + fmtUsd(data.totalCostUsd)}
              title={`${fmtUsdFull(data.totalCostUsd)} API-equivalent estimate from recorded token classes and ${data.pricingSource} rates checked ${data.pricingListDate}. Not actual subscription/provider spend. Aggregate estimates exclude request-level long-context surcharges when the transcript does not preserve enough threshold evidence.`}
              sub={`${(pricingCoverage * 100).toFixed(0)}% coverage · ${fmtNum(data.totalPricedSessions)} priced`}
            />
            <StatCell
              label="Input + output"
              value={fmtNum(ioTokens)}
              title={`${fmtNumFull(ioTokens)} input + output usage reported across model calls. This is processed usage, not unique text; separately reported cache reads are excluded.`}
              sub={`↑${fmtNum(data.totalInputTokens)} ↓${fmtNum(data.totalOutputTokens)}`}
            />
            <StatCell
              label="Cached ctx"
              value={fmtNum(cacheRead)}
              title={`${fmtNumFull(cacheRead)} cache-read tokens — context re-read across turns (billed at cache rates), plus ${fmtNumFull(data.totalCacheCreateTokens ?? 0)} written to cache`}
              sub={cacheMult > 0 ? `${cacheMult.toFixed(1)}× input+output` : undefined}
            />
          </StatGroup>

          <StatGroup icon={Hammer} label="Work">
            <StatCell label="Calls" value={fmtNum(data.totalToolCalls)} title={`${fmtNumFull(data.totalToolCalls)} tool calls`} />
            <StatCell
              label="Errors"
              value={data.totalToolCalls > 0 ? `${toolErrPct.toFixed(1)}%` : "—"}
              tone={toolErrPct >= 5 ? "text-err" : undefined}
              title={`${fmtNumFull(toolErrTotal)} failed calls of ${fmtNumFull(data.totalToolCalls)}`}
              sub={toolErrTotal > 0 ? `${fmtNum(toolErrTotal)} failed` : undefined}
            />
            <StatCell
              label="Peak hour"
              value={busiest && busiest.v > 0 ? `${DAYS[busiest.d]} ${String(busiest.h).padStart(2, "0")}:00` : "—"}
              sub={busiest && busiest.v > 0 ? `${fmtNum(busiest.v)} sessions` : undefined}
            />
          </StatGroup>
        </div>
      </section>

      <section className="card p-3 mb-6">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(q); }}
          className="flex items-center gap-2"
        >
          <Search className="size-4 text-fg-dim shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search every session, every harness… (e.g. auth refactor)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
          />
          <button
            type="submit"
            disabled={searching || !q.trim()}
            className="rounded-md border border-bd px-2.5 py-1 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
          {indexInfo && indexInfo.indexedFiles < indexInfo.totalFiles && (
            <button
              type="button"
              onClick={buildIndex}
              disabled={indexing}
              title="Reads transcripts and indexes their text for search. Incremental — only new/changed files are read."
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1 text-sm text-warn hover:bg-bg-elev transition-colors disabled:opacity-60"
            >
              <DatabaseZap className={clsx("size-3.5", indexing && "animate-pulse")} />
              {indexing ? `Indexing ${indexInfo.indexedFiles}/${indexInfo.totalFiles}…` : `Index ${indexInfo.totalFiles - indexInfo.indexedFiles} files`}
            </button>
          )}
        </form>
        {hits !== null && (
          <div className="mt-3 border-t border-bd/50 pt-2">
            {indexInfo && indexInfo.indexedFiles < indexInfo.totalFiles && !indexing && (
              <p className="text-[11px] text-warn mb-2">Only {indexInfo.indexedFiles}/{indexInfo.totalFiles} files indexed — results may be incomplete.</p>
            )}
            {hits.length === 0 && <p className="text-sm text-fg-dim py-2">No matches.</p>}
            <div className="space-y-1">
              {hits.map((h) => (
                <Link
                  key={h.file}
                  href={`/collection/session?file=${encodeURIComponent(h.file)}`}
                  className="block text-sm rounded-md px-2 py-1.5 -mx-2 hover:bg-bg-elev transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] shrink-0">{h.sourceId}</span>
                    <span className="truncate font-medium">{show(h.title || h.file.split("/").pop())}</span>
                    <span className="text-[11px] text-fg-dim mono shrink-0 ml-auto tabular-nums">{fmtRel(h.at, data.generatedAtMs)}</span>
                  </div>
                  <div className="text-[12px] text-fg-muted mono mt-0.5 line-clamp-2">{show(h.snippet)}</div>
                  <div className="text-[10px] text-fg-dim truncate">{compactDisplayPath(h.project, redact)}</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {hasWeekly && rollup && (
        <section id="usage" className="scroll-mt-16 mb-6">
          <SectionHeader
            icon={TrendingUp}
            title="Usage"
            desc="Weekly API-list equivalent, volume, and where it goes — full history, every harness"
            right={`${rollup.weekly.length}w window`}
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <WeeklyUsageChart rollup={rollup} />
            <div className="card p-4">
              <h3 className="text-[11px] uppercase tracking-wider text-fg-muted mb-2.5">Top projects by API equivalent</h3>
              <div className="space-y-2">
                {rollup.byProject.map((p) => (
                  <div key={p.project} title={`${fmtNumFull(p.sessions)} sessions · ${fmtNum(p.tokens)} input + output tokens · last active ${fmtRel(p.lastActiveMs, data.generatedAtMs)}`}>
                    <div className="flex items-center gap-2 text-sm min-w-0">
                      <span className="truncate flex-1 text-fg-muted text-[12px]">{compactDisplayPath(p.project, redact).split("/").slice(-2).join("/")}</span>
                      <span className="mono tabular-nums text-[12px] shrink-0">{(rollup.anyEstimatedCost ? "~" : "") + fmtUsd(p.costUsd)}</span>
                    </div>
                    <div
                      className="h-[3px] rounded-full mt-1"
                      style={{
                        width: `${Math.max(2, (p.costUsd / projectMax) * 100)}%`,
                        background: "color-mix(in srgb, var(--color-accent) 45%, transparent)",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {hasHeatmap && rollup && (
        <section id="rhythm" className="scroll-mt-16 mb-6">
          <SectionHeader
            icon={CalendarClock}
            title="Rhythm"
            desc="When sessions start — weekday × hour, plus the day-part split"
            right={`${fmtNum(rollup.heatmapSessions ?? 0)} sessions`}
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <ActivityHeatmap heatmap={hm} totalSessions={rollup.heatmapSessions ?? 0} />
            <RhythmPanel heatmap={hm} />
          </div>
        </section>
      )}

      {hasModels && (
        <section id="models" className="scroll-mt-16 mb-6">
          <SectionHeader
            icon={Cpu}
            title="Models"
            desc="Normalized model identities, measured usage, and rate provenance across harnesses"
            right={`${models.length} models · ${tilde}${fmtUsd(totalModelCost)} API eq.`}
          />
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Sessions</th>
                    <th className="num">I/O tokens</th>
                    <th className="num">Cache reads</th>
                    <th className="num">Tool calls</th>
                    <th className="num">Tool err</th>
                    <th className="num">API equiv.</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const errPct = m.toolCalls ? (m.toolErrors / m.toolCalls) * 100 : 0;
                    const share = totalModelCost > 0 ? m.costUsd / totalModelCost : m.sessions / totalModelSessions;
                    const modelCostEstimated = m.listedRateSessions + m.familyRateSessions + m.fallbackRateSessions > 0;
                    return (
                      <tr key={m.model}>
                        <td className="mono text-[11px]">
                          <div>{m.model === "unknown" ? <span className="text-fg-dim">unknown</span> : m.model}</div>
                          <PricingEvidence model={m} />
                        </td>
                        <td className="num" title={`${fmtNumFull(m.pricedSessions)} priced · ${fmtNumFull(m.inferredModelSessions)} inferred model ids`}>{fmtNum(m.sessions)}</td>
                        <td className="num text-fg-muted" title={`${fmtNumFull(m.inputTokens + m.outputTokens)} input + output — ↑${fmtNum(m.inputTokens)} ↓${fmtNum(m.outputTokens)}; processed usage, not unique text`}>{fmtNum(m.inputTokens + m.outputTokens)}</td>
                        <td className="num text-fg-dim" title={fmtNumFull(m.cacheReadTokens)}>{fmtNum(m.cacheReadTokens)}</td>
                        <td className="num text-fg-muted">{fmtNum(m.toolCalls)}</td>
                        <td className={clsx("num", errPct >= 5 ? "text-err" : "text-fg-dim")}>{m.toolCalls ? `${errPct.toFixed(1)}%` : "—"}</td>
                        <td className="num" title={`${fmtUsdFull(m.costUsd)} API-equivalent estimate · ${fmtNumFull(m.pricedSessions)}/${fmtNumFull(m.sessions)} sessions priced · ${fmtNumFull(m.listedRateSessions)} listed, ${fmtNumFull(m.familyRateSessions)} family-mapped, ${fmtNumFull(m.fallbackRateSessions)} fallback · not actual spend`}>
                          {m.costUsd > 0 ? (modelCostEstimated ? "~" : "") + fmtUsd(m.costUsd) : "—"}
                        </td>
                        <td className="num"><ShareBar frac={share} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-1.5 border-t border-bd-subtle text-[10px] text-fg-dim">
              Share is of {totalModelCost > 0 ? "estimated API-equivalent value" : "sessions"}. Input + output is processed usage, not unique text; cache reads are reported separately. Pricing evidence: {fmtNum(data.totalListedRateSessions)} listed-rate, {fmtNum(data.totalFamilyRateSessions)} family-mapped, {fmtNum(data.totalFallbackRateSessions)} fallback session estimates.
            </div>
          </div>
        </section>
      )}

      {hasTools && (
        <section id="tools" className="scroll-mt-16 mb-6">
          <SectionHeader
            icon={Wrench}
            title="Tools"
            desc="Most-called tools across every harness, with failure rates"
            right={`${fmtNum(data.totalToolCalls)} calls`}
          />
          <ToolHealthList tools={tools} fullWidth hideHeading />
        </section>
      )}

      <section id="harnesses" className="scroll-mt-16 mb-6">
        <SectionHeader
          icon={HardDrive}
          title="Harnesses"
          desc="Every known agent harness on this machine — present, empty, or absent"
          right={`${data.presentSources} present · ${data.sources.length} known`}
        />
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Harness</th>
                  <th>Status</th>
                  <th>Format</th>
                  <th className="num">Files</th>
                  <th className="num">Parsed</th>
                  <th className="num">I/O tokens</th>
                  <th className="num">API equiv.</th>
                  <th className="num">DQ</th>
                  <th className="num">Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.id} className={clsx(s.status === "absent" && "opacity-45")}>
                    <td>
                      <div className="font-medium flex items-center gap-1.5">
                        {s.label}
                        {s.scanWarnings.length > 0 && (
                          <AlertTriangle className="size-3 text-warn shrink-0" aria-label="Scan warnings" role="img" />
                        )}
                      </div>
                      {!s.parseable && <div className="text-[10px] text-fg-dim flex items-center gap-1"><HelpCircle className="size-3" /> detect-only{s.note ? ` — ${s.note}` : ""}</div>}
                    </td>
                    <td><StatusPill status={s.status} /></td>
                    <td className="mono text-[11px] text-fg-muted">{s.format}</td>
                    <td className="num">{s.filesFound ? fmtNum(s.filesFound) : "—"}</td>
                    <td className="num" title={s.archivedSessions > 0 ? `${s.archivedSessions} archived (files pruned from disk; kept from the parse archive)` : undefined}>
                      {s.parseable ? <>{fmtNum(s.parsedSessions)}{s.archivedSessions > 0 && <span className="text-fg-dim text-[10px]"> incl. {fmtNum(s.archivedSessions)}a</span>}</> : <span className="text-fg-dim">n/a</span>}
                    </td>
                    <td className="num text-fg-muted" title={s.parseable && s.parsedSessions ? `${fmtNumFull(s.totalInputTokens + s.totalOutputTokens)} input + output · ${fmtNum(s.totalCacheReadTokens)} cache reads · processed usage, not unique text` : undefined}>{s.parseable && s.parsedSessions ? fmtNum(s.totalInputTokens + s.totalOutputTokens) : "—"}</td>
                    <td className="num text-fg-muted" title={s.parseable && s.totalCostUsd ? `${fmtUsdFull(s.totalCostUsd)} API-equivalent estimate · ${fmtNumFull(s.pricedSessions)}/${fmtNumFull(s.parsedSessions)} sessions priced · not actual spend` : undefined}>{s.parseable && s.totalCostUsd ? (s.costEstimated ? "~" : "") + fmtUsd(s.totalCostUsd) : "—"}</td>
                    <td
                      className={clsx("num", s.parseable && s.parsedSessions > 0 && s.avgDataQuality < 50 ? "text-warn" : "text-fg-dim")}
                      title={s.parseable && s.parsedSessions > 0 ? `Average data quality 0–100 — model/token/timing provenance and parse health${s.scanWarnings.length ? `\n${s.scanWarnings.join("\n")}` : ""}` : undefined}
                    >
                      {s.parseable && s.parsedSessions > 0 ? Math.round(s.avgDataQuality) : "—"}
                    </td>
                    <td className="num text-fg-dim">{fmtRel(s.lastActivityMs, data.generatedAtMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {data.unknown.length > 0 && (
          <div className="card p-3 mt-3">
            <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-2 flex items-center gap-1.5">
              <HelpCircle className="size-3.5" /> Unknown transcript-like sources ({data.unknown.length})
            </div>
            <p className="text-[11px] text-fg-dim mb-2">Found transcript-shaped JSONL from a harness we don&apos;t recognize yet. Not parsed into metrics — add a registry entry to collect them accurately.</p>
            <div className="space-y-1">
              {data.unknown.map((u) => (
                <div key={u.dir} className="flex items-center justify-between text-[12px] mono">
                  <span className="text-fg-muted truncate">{show(u.displayDir)}</span>
                  <span className="text-fg-dim shrink-0 ml-3 tabular-nums">{u.fileCount} jsonl</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section id="sessions" className="scroll-mt-16 mb-5">
        <SectionHeader
          icon={History}
          title="Sessions"
          desc="Most recent sessions across all harnesses — click one to read its transcript"
          right={loadedLabel}
        />
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-bd-subtle px-3 py-2">
            <SelectPill
              icon={Filter}
              value={harnessFilter}
              onChange={setHarnessFilter}
              options={[["all", "All harnesses"], ...harnessOptions]}
            />
            <SelectPill
              icon={Cpu}
              value={modelFilter}
              onChange={setModelFilter}
              options={[["all", "All models"], ...modelOptions.map((m): [string, string] => [m, m])]}
            />
            <SelectPill
              icon={ArrowDownWideNarrow}
              value={sessionSort}
              onChange={(v) => setSessionSort(v as SessionSort)}
              options={[["recent", "Recent"], ["tokens", "Tokens"], ["duration", "Duration"], ["tools", "Tool calls"]]}
            />
            <span className="ml-auto text-[11px] text-fg-dim tabular-nums">
              {sessionsFiltered ? `${fmtNumFull(visibleSessions.length)} match · ` : ""}{loadedLabel}
            </span>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Session</th>
                  <th>Model</th>
                  <th className="num">Dur</th>
                  <th className="num">Tokens</th>
                  <th className="num">Tools</th>
                  <th className="num">DQ</th>
                  <th className="num">When</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-fg-dim text-sm">No parsed sessions found.</td></tr>
                )}
                {data.sessions.length > 0 && visibleSessions.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-fg-dim text-sm">No loaded sessions match the current filters.</td></tr>
                )}
                {visibleSessions.map((s, i) => {
                  const title = show(s.displayTitle || s.lastPromptPreview) || compactDisplayPath(s.project, redact);
                  const project = compactDisplayPath(s.project, redact);
                  return (
                    <tr key={s.path ?? `${s.sourceId}-${s.sessionId}-${i}`} className="cv-auto">
                      <td>
                        <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] whitespace-nowrap">{s.sourceLabel}</span>
                        {s.archived && <span className="ml-1 rounded bg-bg-elev text-fg-dim px-1.5 py-0.5 text-[10px]" title="File pruned from disk; kept from the parse archive">archived</span>}
                      </td>
                      <td className="max-w-[280px]">
                        {s.path ? (
                          <Link href={`/collection/session?file=${encodeURIComponent(s.path)}`} className="block group" title={title}>
                            <span className="block truncate text-[12px] text-fg group-hover:text-accent-soft group-hover:underline">{title}</span>
                            <span className="block truncate text-[10px] text-fg-dim">{project}</span>
                          </Link>
                        ) : (
                          <span className="block" title={title}>
                            <span className="block truncate text-[12px] text-fg-muted">{title}</span>
                            <span className="block truncate text-[10px] text-fg-dim">{project}</span>
                          </span>
                        )}
                      </td>
                      <td className="mono text-[11px]">{s.model ?? <span className="text-fg-dim">unknown</span>}</td>
                      <td className="num text-fg-dim">{s.durationMs > 0 ? fmtDuration(s.durationMs) : "—"}</td>
                      <td className="num text-fg-muted" title={fmtNumFull(s.inputTokens + s.outputTokens)}>{fmtNum(s.inputTokens + s.outputTokens)}</td>
                      <td className="num">{s.toolCalls}{s.toolErrors > 0 && <span className="text-err"> ({s.toolErrors}✗)</span>}</td>
                      <td className="num text-fg-dim">{Math.round(s.dataQuality)}</td>
                      <td className="num text-fg-dim whitespace-nowrap">{fmtRel(s.lastEventAt, data.generatedAtMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.sessions.length < data.totalParsedSessions && (
            <div className="flex items-center justify-between gap-2 border-t border-bd-subtle px-3 py-2">
              <span className="text-[11px] text-fg-dim tabular-nums">{loadedLabel}</span>
              {moreAvailable ? (
                <button
                  onClick={loadMore}
                  disabled={loadingMore || loading}
                  className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
                >
                  {loadingMore
                    ? <RefreshCw className="size-3.5 animate-spin" />
                    : <ChevronDown className="size-3.5" />}
                  {loadingMore
                    ? "Loading…"
                    : `Load ${fmtNumFull(Math.min(LOAD_STEP, data.totalParsedSessions - data.sessions.length))} more`}
                </button>
              ) : (
                <span className="text-[11px] text-fg-dim">
                  older sessions aren&apos;t listable — the scanner keeps only the newest sessions per harness
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {data.anyEstimatedCost && (
        <p className="text-[11px] text-fg-dim mt-3">
          ~ Dollar values are <span className="text-fg-muted">API-equivalent list estimates</span>, not subscription/provider spend. They use token evidence plus {data.pricingSource} rates checked {data.pricingListDate}; family and fallback mappings remain visibly labeled. Request-level long-context surcharges may be absent when the transcript lacks threshold evidence.
        </p>
      )}
    </div>
  );
}
