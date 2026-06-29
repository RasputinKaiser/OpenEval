"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "./StatusBadge";
import HarnessBadge from "./HarnessBadge";
import { ChevronDown } from "lucide-react";
import type { RunRecord } from "@/lib/types";

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
  }, [runs, statusFilter, sort]);

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
          <span className="ml-auto text-xs text-fg-dim mono">
            {visible.length}/{runs.length} shown
          </span>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-fg-muted">
          No runs match. <Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
        </div>
      ) : (
        <div className="card overflow-hidden">
          {visible.map((r) => (
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
                  <span className={clsx(
                    "text-sm mono font-semibold tabular-nums",
                    r.summary.passRate >= 1 ? "text-ok" : r.summary.passRate >= 0.5 ? "text-warn" : "text-err"
                  )}>
                    {(r.summary.passRate * 100).toFixed(0)}%
                  </span>
                )}
                <StatusBadge status={r.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}