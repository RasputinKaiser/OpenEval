"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "./StatusBadge";
import HarnessBadge from "./HarnessBadge";
import { ChevronDown, Search, X } from "lucide-react";
import { MetricDistribution } from "./charts/MetricDistribution";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";
import { statusCounts } from "@/lib/run-chart-analysis";
import type { RunRecord } from "@/lib/types";
import { fmtDateTime, fmtStableDateTime } from "@/lib/format";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { useDebouncedValue } from "@/lib/use-debounced-value";

type SortKey = "newest" | "oldest" | "pass-desc" | "pass-asc";
type StatusFilter = "all" | "running" | "completed" | "failed" | "passed" | "aborted";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "pass-desc", label: "Pass % ↓" },
  { key: "pass-asc", label: "Pass % ↑" },
];

const STATUSES: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
  { key: "passed", label: "Has passes" },
  { key: "failed", label: "Failed" },
  { key: "aborted", label: "Aborted" },
];

export default function RunsClient({ runs, referenceTimeMs }: { runs: RunRecord[]; referenceTimeMs?: number }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [comparison, setComparison] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [pageSize, setPageSize] = useState(50);
  const [nowMs, setNowMs] = useState<number | null>(referenceTimeMs ?? null);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("status"), order = params.get("sort"), limit = Number(params.get("limit"));
      setStatusFilter(STATUSES.some((item) => item.key === status) ? status as StatusFilter : "all");
      setSort(SORTS.some((item) => item.key === order) ? order as SortKey : "newest");
      setSearch(params.get("q") ?? "");
      setComparison([...new Set((params.get("compare") ?? "").split(",").filter(id => runs.some(run => run.id === id)))].slice(0, 2));
      setPageSize([25,50,100,200].includes(limit) ? limit : 50);
    };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [runs]);
  const changeFilter = (patch: Record<string, string | null>, replace = false) => {
    const url = new URL(window.location.href);
    for (const [key,value] of Object.entries(patch)) { if (value === null) url.searchParams.delete(key); else url.searchParams.set(key,value); }
    if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const distribution = statusCounts(runs);

  const visible = useMemo(() => {
    let filtered = runs;
    if (statusFilter !== "all") {
      if (statusFilter === "passed") {
        filtered = runs.filter((r) => (r.summary?.passed ?? 0) > 0);
      } else if (statusFilter === "completed") {
        filtered = runs.filter((r) => r.status === "completed");
      } else {
        filtered = runs.filter((r) => r.status === statusFilter);
      }
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.params.harness ?? "").toLowerCase().includes(q));
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "newest") return b.created_at - a.created_at;
      if (sort === "oldest") return a.created_at - b.created_at;
      const ap = a.summary?.passRate ?? 0;
      const bp = b.summary?.passRate ?? 0;
      if (sort === "pass-desc") return bp - ap;
      return ap - bp;
    });
    return sorted;
  }, [runs, statusFilter, sort, debouncedSearch]);

  const dateSorted = sort === "newest" || sort === "oldest";
  const paged = visible.slice(0, pageSize);
  const groups = useMemo(() => {
    if (!dateSorted || nowMs === null) return [{ label: "", items: paged }];
    const current = new Date(nowMs);
    const startOfUtcDay = (ms: number) => {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    };
    const today = startOfUtcDay(current.getTime());
    const dayMs = 86_400_000;
    const result: { label: string; items: typeof visible }[] = [];
    let currentLabel = "";
    let bucket: typeof visible = [];
    for (const r of paged) {
      const dayStart = startOfUtcDay(r.created_at);
      const daysAgo = Math.floor((today - dayStart) / dayMs);
      let label: string;
      if (daysAgo === 0) label = "Today";
      else if (daysAgo === 1) label = "Yesterday";
      else if (daysAgo < 7) label = "This week";
      else if (daysAgo < 30) label = "This month";
      else label = "Older";
      if (label !== currentLabel) {
        if (bucket.length) result.push({ label: currentLabel, items: bucket });
        currentLabel = label;
        bucket = [];
      }
      bucket.push(r);
    }
    if (bucket.length) result.push({ label: currentLabel, items: bucket });
    return result;
  }, [paged, dateSorted, nowMs]);

  return (
    <div>
      {statusFilter !== "all" && <div className="flex gap-2 items-center text-xs mb-3"><span>Run status: {statusFilter}</span><button type="button" className="analysis-control" onClick={() => changeFilter({ status: null })}>Remove status filter</button></div>}
      {runs.length > 3 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                onClick={() => changeFilter({ status: s.key === "all" ? null : s.key })}
                aria-pressed={statusFilter === s.key}
                className={clsx(
                  "min-h-11 sm:min-h-8 text-xs px-2.5 py-1.5 rounded-md border transition-colors",
                  statusFilter === s.key
                    ? "border-accent bg-accent/10 text-accent-soft"
                    : "border-bd text-fg-muted hover:bg-bg-elev"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="mx-1 text-fg-dim text-xs">·</span>
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-haspopup="menu"
              className="inline-flex min-h-11 sm:min-h-8 items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-bd text-fg-muted hover:bg-bg-elev"
            >
              {SORTS.find((s) => s.key === sort)?.label}
              <ChevronDown className={clsx("size-3 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div
                  className="absolute z-20 mt-1 w-32 bg-bg-subtle border border-bd rounded-md shadow-xl py-1 origin-top"
                  style={{ animation: "menu-enter 120ms cubic-bezier(0.2, 0, 0, 1)" }}
                >
                  {SORTS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => { changeFilter({ sort: s.key === "newest" ? null : s.key }); setOpen(false); }}
                      aria-pressed={sort === s.key}
                      className={clsx(
                        "w-full min-h-11 sm:min-h-8 text-left px-3 py-1.5 text-xs hover:bg-bg-elev",
                        sort === s.key && "text-accent-soft"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => changeFilter({ q: e.target.value || null }, true)}
              aria-label="Search runs"
              placeholder="Search runs…"
              className="w-32 lg:w-44 min-h-11 sm:min-h-8 pl-8 pr-2 py-1.5 text-xs bg-bg border border-bd rounded-md focus:outline-none focus:border-accent transition-colors placeholder:text-fg-dim"
            />
            {search && (
              <button onClick={() => changeFilter({ q: null })} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg" aria-label="Clear search">
                <X className="size-3" />
              </button>
            )}
          </div>
          <span className="ml-auto flex items-center gap-2 text-xs text-fg-dim mono">
            <select
              value={pageSize}
              onChange={(e) => changeFilter({ limit: e.target.value === "50" ? null : e.target.value })}
              aria-label="Runs per page"
              className="min-h-11 sm:min-h-8 text-xs bg-bg border border-bd rounded-md px-1.5 py-1 focus:outline-none focus:border-accent"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
            <span className="tabular-nums">{Math.min(visible.length, pageSize)}/{runs.length}</span>
          </span>
        </div>
      )}

      <details className="card p-4 mb-3"><summary className="cursor-pointer text-sm font-medium">Run status across loaded history</summary><div className="mt-3"><ChartFrame title="Recent run status" description={`Counts describe the ${runs.length} runs loaded on this page (at most the latest 50), before search and status filtering.`} unit="Run status is separate from case pass rate."
        table={{ headers: ["Run status", "Count"], rows: distribution.map((item) => ({ id: item.status, cells: [item.status, item.count] })) }}>
        <SelectableBars rows={distribution.map((item) => ({ id: item.status, label: item.status, value: item.count, tone: item.status === "failed" ? "err" : item.status === "completed" ? "ok" : "accent" }))} noun="runs" onExplore={(status) => changeFilter({ status })} selectedId={statusFilter} />
      </ChartFrame></div></details>
      <details className="card p-4 mb-4">
        <summary className="cursor-pointer text-sm font-medium">Analyze filtered runs · {visible.length} runs</summary>
        <p className="text-xs text-fg-muted mt-2">Run totals can reflect different workloads. Compare matching cases to assess changes.</p>
        <div className="grid md:grid-cols-2 gap-3 mt-3 analysis-reveal">
          <MetricDistribution title="Elapsed run time" values={visible.map(run => run.ended_at != null ? run.ended_at - run.created_at : null)} format={value => `${(value / 1000).toFixed(1)}s`} unit="Seconds from creation to recorded end" description="Includes setup and grading time. Runs without a recorded end are excluded." />
          <MetricDistribution title="Recorded cost per run" values={visible.map(run => run.summary && run.summary.missingCostCases === 0 ? run.summary.totalCostUsd : null)} format={value => `$${value.toFixed(3)}`} unit="USD · measured and estimated costs" description="Runs with missing or unspecified cost coverage are excluded from this distribution." />
        </div>
      </details>
      {comparison.length > 0 && <div className="card flex flex-wrap gap-3 items-center p-3 mb-4 analysis-reveal" aria-live="polite"><span className="text-xs">{comparison.length}/2 runs selected · first selection is baseline A</span><Link className="analysis-control" aria-disabled={comparison.length !== 2} href={comparison.length === 2 ? `/runs/compare?a=${encodeURIComponent(comparison[0])}&b=${encodeURIComponent(comparison[1])}` : "#"} onClick={event => { if (comparison.length !== 2) event.preventDefault(); }}>Compare selected runs</Link><button className="analysis-control" type="button" onClick={() => changeFilter({ compare: null })}>Clear selection</button></div>}
      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-fg-muted">
          No runs match. <button type="button" className="analysis-control mr-2" onClick={() => changeFilter({ status: null, q: null })}>Clear filters</button><Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.label}>
              {dateSorted && group.label && (
                <div className="px-1 pb-1.5 pt-2 text-[10px] uppercase tracking-[0.12em] text-fg-dim">{group.label}</div>
              )}
              <div className="card overflow-hidden">
                {group.items.map((r) => (
                  <div key={r.id} className="flex items-center border-b border-bd-subtle last:border-0">
                  <label className="p-3 flex items-center min-h-11" title="Select for comparison"><input type="checkbox" aria-label={`Compare ${r.name}`} checked={comparison.includes(r.id)} disabled={comparison.length === 2 && !comparison.includes(r.id)} onChange={() => changeFilter({ compare: (comparison.includes(r.id) ? comparison.filter(id => id !== r.id) : [...comparison, r.id]).join(",") || null })} /></label>
                  <Link
                    href={`/runs/${r.id}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-bg-elev"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="text-[11px] text-fg-dim mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <time dateTime={fmtStableDateTime(r.created_at)} title={fmtDateTime(r.created_at)}>
                          {nowMs === null ? fmtStableDateTime(r.created_at) : fmtDateTime(r.created_at)}
                        </time> · {r.params.runner}
                        {r.params.harness && <HarnessBadge harness={r.params.harness} />}
                        <span>· {r.params.parallel}×</span>
                        {r.params.samples && r.params.samples > 1 ? <span>· {r.params.samples} samples</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {r.summary && (
                        <div className="text-right">
                          <span className={clsx(
                            "text-sm mono font-semibold tabular-nums",
                            r.summary.passRate >= 1 ? "text-ok" : r.summary.passRate >= 0.5 ? "text-warn" : "text-err"
                          )}>
                            {(r.summary.passRate * 100).toFixed(0)}%
                          </span>
                          <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-bg-elev">
                            {r.summary.total > 0 && (
                              <div className="h-full flex">
                                <div className="bg-ok" style={{ width: `${(r.summary.passed / r.summary.total) * 100}%` }} />
                                {(r.summary.failed > 0 || r.summary.errored > 0) && (
                                  <div className="bg-err" style={{ width: `${(r.summary.failed / r.summary.total) * 100}%` }} />
                                )}
                                {r.summary.errored > 0 && (
                                  <div className="bg-warn" style={{ width: `${(r.summary.errored / r.summary.total) * 100}%` }} />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <StatusBadge status={r.status} />
                    </div>
                  </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
