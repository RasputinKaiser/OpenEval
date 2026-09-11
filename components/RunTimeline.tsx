"use client";

import { memo, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { executionLanes } from "@/lib/run-chart-analysis";
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
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!live) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  const timeline = useMemo(() => executionLanes(cases, live ? now : null), [cases, now, live]);
  if (!timeline.segments.length) return null;
  const segments = timeline.segments.map((segment) => ({ ...segment, c: cases[segment.index], i: segment.index, durMs: segment.durationMs }));
  const visibleLanes = expanded ? timeline.lanes : Math.min(6, timeline.lanes);
  const workDuration = segments.reduce((sum, s) => sum + s.durMs, 0);

  return (
    <div className="mb-4 rounded-xl border border-bd bg-bg-subtle p-3" data-testid="run-execution-timeline">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="size-1.5 rounded-full bg-accent" />
          Execution timeline · {segments.length} case{segments.length === 1 ? "" : "s"}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
          <span>elapsed: <span className="text-fg">{fmtDur(timeline.elapsedMs)}</span> <span className="text-fg-dim">(case span)</span></span>
          <span>work: <span className="text-fg">{fmtDur(workDuration)}</span> <span className="text-fg-dim">(overlap summed)</span></span>
          {live && <span className="ml-2 inline-flex items-center gap-1 text-sky-400"><span className="size-1.5 animate-pulse rounded-full bg-sky-400" />live</span>}
        </span>
      </div>
      <div className="relative w-full overflow-hidden rounded" style={{ height: visibleLanes * 44 }}>
        {/* Grid lines for scale */}
        <div className="pointer-events-none absolute inset-0 flex justify-between opacity-30">
          {[0, 25, 50, 75, 100].map((p) => (
            <div key={p} className="w-px bg-fg-dim" />
          ))}
        </div>
        {segments.filter((segment) => segment.lane < visibleLanes).map((s) => (
          <button
            key={s.c.id}
            type="button"
            onClick={() => onSelect(s.i)}
            title={`${s.c.case_name} · sample ${(s.c.sample ?? 0) + 1} · ${s.c.status} · ${fmtDur(s.durMs)}`}
            aria-label={`Case ${s.c.case_name}, sample ${(s.c.sample ?? 0) + 1}, status ${s.c.status}, duration ${fmtDur(s.durMs)}`}
            aria-pressed={selectedIndex === s.i}
            style={{ left: `${Math.min(99.6, s.left)}%`, width: `${Math.max(0.4, s.width)}%`, top: s.lane * 44 + 2, height: 40 }}
            className={clsx(
              "absolute rounded-sm border-x border-black/20 transition-[left,width,box-shadow] duration-150",
              STATUS_FILL[s.c.status] ?? STATUS_FILL.pending,
              selectedIndex === s.i && "ring-2 ring-white/80 ring-offset-1 ring-offset-bg-subtle z-10",
            )}
          />
        ))}
      </div>
      {timeline.lanes > 6 && <button type="button" className="analysis-control mt-2" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show six lanes" : `Show all ${timeline.lanes} overlapping lanes`}</button>}
      <p className="text-xs text-fg-muted mt-2">{timeline.lanes} concurrent lanes · {timeline.omitted} cases without usable timing. Select a segment to open its exact case/sample.</p>
      <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer py-2">Execution data table</summary><div className="analysis-table" role="region" tabIndex={0} aria-label="Case execution timing"><table className="w-full text-left"><thead><tr><th>Case/sample</th><th>Status</th><th>Duration</th><th>Lane</th></tr></thead><tbody>{segments.map((segment) => <tr key={segment.c.id}><td><button type="button" className="analysis-control" onClick={() => onSelect(segment.i)}>{segment.c.case_name} · sample {(segment.c.sample ?? 0) + 1}</button></td><td>{segment.c.status}</td><td>{fmtDur(segment.durMs)}</td><td>{segment.lane + 1}</td></tr>)}</tbody></table></div></details>
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
        {cases.some((c) => c.status === "skipped") && (
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-sm bg-fg-dim/40" />
            skipped <span className="tabular-nums text-fg">{cases.filter((c) => c.status === "skipped").length}</span>

          </span>
        )}
      </div>
    </div>
  );
}

export default memo(RunTimelineImpl);
