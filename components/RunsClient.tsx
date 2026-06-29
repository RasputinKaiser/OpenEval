"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "./StatusBadge";
import HarnessBadge from "./HarnessBadge";
import { ChevronDown, Search, X } from "lucide-react";
import type { RunRecord } from "@/lib/types";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { useDebouncedValue } from "@/lib/use-debounced-value";

type SortKey = "newest" | "oldest" | "pass-desc" | "pass-asc";
type StatusFilter = "all" | "running" | "completed" | "failed" | "passed";

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
];

export default function RunsClient({ runs }: { runs: RunRecord[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [pageSize, setPageSize] = useState(50);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("status")) setStatusFilter(params.get("status") as StatusFilter);
      if (params.get("sort")) setSort(params.get("sort") as SortKey);
      if (params.get("q")) setSearch(params.get("q") ?? "");
      if (params.get("limit")) setPageSize(Number(params.get("limit")) || 50);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sort !== "newest") params.set("sort", sort);
      if (search) params.set("q", search);
      if (pageSize !== 50) params.set("limit", String(pageSize));
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {}
  }, [statusFilter, sort, search, pageSize]);

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
    if (!dateSorted) return [{ label: "", items: paged }];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 86_400_000;
    const result: { label: string; items: typeof visible }[] = [];
    let currentLabel = "";
    let bucket: typeof visible = [];
    for (const r of paged) {
      const created = new Date(r.created_at);
      const dayStart = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
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
  }, [paged, dateSorted]);

  return (
    <div>
      {runs.length > 3 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={clsx(
                  "text-[11px] px-2.5 py-1.5 rounded-md border transition-colors",
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
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-bd text-fg-muted hover:bg-bg-elev"
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
                      onClick={() => { setSort(s.key); setOpen(false); }}
                      className={clsx(
                        "w-full text-left px-3 py-1.5 text-xs hover:bg-bg-elev",
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runs…"
              className="w-32 lg:w-44 pl-8 pr-2 py-1.5 text-[11px] bg-bg border border-bd rounded-md focus:outline-none focus:border-accent focus:w-40 lg:focus:w-52 transition-all placeholder:text-fg-dim"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg" aria-label="Clear search">
                <X className="size-3" />
              </button>
            )}
          </div>
          <span className="ml-auto flex items-center gap-2 text-xs text-fg-dim mono">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="text-[11px] bg-bg border border-bd rounded-md px-1.5 py-1 focus:outline-none focus:border-accent"
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

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-fg-muted">
          No runs match. <Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.label}>
              {dateSorted && group.label && (
                <div className="px-1 pb-1.5 pt-2 text-[10px] uppercase tracking-wider text-fg-dim">{group.label}</div>
              )}
              <div className="card overflow-hidden">
                {group.items.map((r) => (
                  <Link
                    key={r.id}
                    href={`/runs/${r.id}`}
                    className="flex items-center justify-between gap-4 border-b border-bd-subtle px-4 py-3 transition-colors last:border-0 hover:bg-bg-elev"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="text-[11px] text-fg-dim mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {new Date(r.created_at).toLocaleString()} · {r.params.runner}
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
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}