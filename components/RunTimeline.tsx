"use client";

import { memo, useMemo } from "react";
import clsx from "clsx";
import type { RunCaseRecord } from "@/lib/types";

interface Props {
  cases: RunCaseRecord[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  live: boolean;
}

const STATUS_FILL: Record<string, string> = {
  passed: "bg-emerald-500/80 hover:bg-emerald-400",
  failed: "bg-rose-500/80 hover:bg-rose-400",
  error: "bg-amber-500/80 hover:bg-amber-400",
  running: "bg-sky-500/80 hover:bg-sky-400 animate-pulse",
  grading: "bg-violet-500/80 hover:bg-violet-400 animate-pulse",
  pending: "bg-fg-dim/40 hover:bg-fg-dim/60",
  skipped: "bg-fg-dim/20 hover:bg-fg-dim/40",
};

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function RunTimelineImpl({ cases, selectedIndex, onSelect, live }: Props) {
  const segments = useMemo(() => {
    const withTimes = cases
      .map((c, i) => ({ c, i, start: c.started_at, end: c.ended_at }))
      .filter((s) => s.start != null);
    if (withTimes.length === 0) return null;

    const minStart = Math.min(...withTimes.map((s) => s.start!));
    const maxEnd = Math.max(...withTimes.map((s) => s.end ?? Date.now()));
    const totalSpan = Math.max(maxEnd - minStart, 1);

    return withTimes.map((s) => {
      const start = s.start!;
      const end = s.end ?? Date.now();
      const left = ((start - minStart) / totalSpan) * 100;
      const width = Math.max(((end - start) / totalSpan) * 100, 0.4);
      return { c: s.c, i: s.i, left, width, durMs: end - start };
    });
  }, [cases]);

  if (!segments || segments.length === 0) return null;

  const totalDur = (() => {
    if (segments.length === 0) return 0;
    return segments.reduce((sum, s) => sum + s.durMs, 0);
  })();

  return (
    <div className="mb-4 rounded-lg border border-bd bg-card p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="size-1.5 rounded-full bg-accent" />
          Timeline · {segments.length} case{segments.length === 1 ? "" : "s"}
        </span>
        <span className="tabular-nums">
          wall: <span className="text-fg">{fmtDur(totalDur)}</span>
          {live && <span className="ml-2 inline-flex items-center gap-1 text-sky-400"><span className="size-1.5 animate-pulse rounded-full bg-sky-400" />live</span>}
        </span>
      </div>
      <div className="relative h-7 w-full overflow-hidden rounded">
        {/* Grid lines for scale */}
        <div className="pointer-events-none absolute inset-0 flex justify-between opacity-30">
          {[0, 25, 50, 75, 100].map((p) => (
            <div key={p} className="w-px bg-fg-dim" />
          ))}
        </div>
        {segments.map((s) => (
          <button
            key={s.c.id}
            type="button"
            onClick={() => onSelect(s.i)}
            title={`${s.c.case_name} · ${s.c.status} · ${fmtDur(s.durMs)}`}
            aria-label={`Case ${s.c.case_name}, status ${s.c.status}, duration ${fmtDur(s.durMs)}`}
            aria-pressed={selectedIndex === s.i}
            style={{ left: `${s.left}%`, width: `${s.width}%` }}
            className={clsx(
              "absolute top-1 bottom-1 rounded-sm border-x border-black/20 transition-all duration-150",
              STATUS_FILL[s.c.status] ?? STATUS_FILL.pending,
              selectedIndex === s.i && "ring-2 ring-white/80 ring-offset-1 ring-offset-card z-10",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-fg-muted">
        {[
          { k: "passed", lbl: "pass" },
          { k: "failed", lbl: "fail" },
          { k: "error", lbl: "error" },
          { k: "running", lbl: "run" },
          { k: "grading", lbl: "grade" },
          { k: "pending", lbl: "pending" },
        ].map((x) => {
          const n = cases.filter((c) => c.status === x.k).length;
          if (!n) return null;
          return (
            <span key={x.k} className="inline-flex items-center gap-1">
              <span className={clsx("size-1.5 rounded-sm", STATUS_FILL[x.k]?.split(" ")[0])} />
              {x.lbl} <span className="tabular-nums text-fg">{n}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default memo(RunTimelineImpl);