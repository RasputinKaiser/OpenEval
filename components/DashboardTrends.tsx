"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";
import type { TimelineReport } from "@/lib/insights/collect";
import { chartSelectionHref } from "@/lib/chart-analysis";
import { fmtDate, fmtNum, fmtSigned } from "@/lib/format";

function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

export default function DashboardTrends({ timeline, error }: { timeline: TimelineReport | null; error?: string | null }) {
  const [periodCount, setPeriodCount] = useState(4);
  if (!timeline) {
    return (
      <section className="card mb-6 p-5" aria-labelledby="dashboard-period-trends-title">
        <h2 id="dashboard-period-trends-title" className="text-sm font-medium">Period trends</h2>
        <p className="mt-2 text-xs leading-5 text-fg-muted">{error ? "Timeline evidence is unavailable, so period trends cannot be read." : "Period trends appear after the first collection snapshot has usable outcome evidence."}</p>
        <Link href="/collection/timeline" className="mt-3 inline-flex items-center gap-1 text-xs text-accent-soft hover:underline">Open Timeline <ArrowRight className="size-3" /></Link>
      </section>
    );
  }

  const points = timeline.outcomeSeries.filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value));
  const visiblePeriodCount = Math.min(periodCount, Math.max(1, points.length));
  const rawPeriods = Array.from({ length: visiblePeriodCount }, (_, index) => {
    const start = Math.floor((index * points.length) / visiblePeriodCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * points.length) / visiblePeriodCount));
    const slice = points.slice(start, end);
    const first = slice[0];
    const last = slice[slice.length - 1];
    return {
      startMs: first?.at ?? null,
      endMs: last ? last.at + 1 : null,
      value: median(slice.map((point) => point.value)),
      plotted: slice.length,
    };
  }).filter((period) => period.value !== null && period.startMs !== null && period.endMs !== null);
  const periods = rawPeriods.map((period, index) => ({
    ...period,
    // Keep period links contiguous over the plotted timeline: every period
    // ends where the next one begins, and only the final period closes after
    // its last plotted timestamp.
    endMs: rawPeriods[index + 1]?.startMs ?? period.endMs,
  }));
  const trendComparable = timeline.overall.comparable !== false && (timeline.overall.firstHalfN ?? 0) > 0 && (timeline.overall.secondHalfN ?? 0) > 0;
  const trend = timeline.overall.trend;
  const TrendIcon = trend >= 0 ? TrendingUp : TrendingDown;

  return (
    <section className="card mb-6 overflow-hidden" aria-labelledby="dashboard-period-trends-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-bd-subtle px-5 py-4">
        <div>
          <h2 id="dashboard-period-trends-title" className="flex items-center gap-1.5 text-sm font-medium"><TrendIcon className={trend >= 0 ? "size-3.5 text-ok" : "size-3.5 text-err"} /> Period trends</h2>
          <p className="mt-1 max-w-prose text-xs text-fg-muted">Each bar is the median of plotted trailing medians across the observed history. Pin a period, then explicitly explore the same range on Timeline.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[10px] text-fg-dim">Periods
            <select aria-label="Trend period count" className="analysis-input ml-1 min-h-9 py-1 text-xs" value={periodCount} onChange={(event) => setPeriodCount(Number(event.target.value))}>
              <option value="2">2</option><option value="4">4</option><option value="6">6</option>
            </select>
          </label>
          <Link href="/collection/timeline" className="inline-flex items-center gap-1 text-xs text-accent-soft hover:underline">Full Timeline <ArrowRight className="size-3" /></Link>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <ChartFrame
          title="Outcome by period"
          description="Select a period to pin its value; use the explicit Explore action to open Timeline."
          evidence={{ population: timeline.totalSessions, eligible: timeline.signalSessions, plotted: points.length, scope: "top-level signal sessions", provenance: "plotted trailing medians" }}
          table={{ headers: ["Period", "Median of plotted trailing medians", "Plotted points"], rows: periods.map((period) => ({ id: `${period.startMs}:${period.endMs}`, cells: [`${fmtDate(period.startMs)} → ${fmtDate(period.endMs! - 1)}`, period.value?.toFixed(2) ?? "—", fmtNum(period.plotted)] })) }}
        >
          {periods.length ? <SelectableBars
            rows={periods.map((period, index) => ({
              id: `${period.startMs}:${period.endMs}`,
              label: `Period ${index + 1} · ${fmtDate(period.startMs)}`,
              value: period.value ?? 0,
              detail: `median of ${fmtNum(period.plotted)} plotted trailing medians · through ${fmtDate(period.endMs! - 1)}`,
            }))}
            format={(value) => value.toFixed(2)}
            noun="this period on Timeline"
            onExplore={(id) => {
              const period = periods.find((candidate) => `${candidate.startMs}:${candidate.endMs}` === id);
              if (period) window.location.assign(chartSelectionHref("/collection/timeline", { fromMs: period.startMs!, toMs: period.endMs! }));
            }}
          /> : <p className="py-5 text-sm text-fg-muted">No outcome signal is available for a period chart.</p>}
        </ChartFrame>
        <div className="rounded-lg border border-bd-subtle bg-bg-subtle/40 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">History verdict</div>
          <div className="mt-1 text-2xl font-semibold mono tabular-nums">{trendComparable ? fmtSigned(trend) : "—"}</div>
          <div className="mt-1 text-xs text-fg-muted">{trendComparable ? `${timeline.overall.firstHalfOutcome.toFixed(2)} → ${timeline.overall.secondHalfOutcome.toFixed(2)}` : "not comparable"}</div>
          <div className="mt-3 border-t border-bd-subtle pt-3 text-[10px] leading-5 text-fg-dim">{fmtNum(timeline.signalSessions)} of {fmtNum(timeline.totalSessions)} sessions carry an outcome signal. Missing outcomes are excluded from medians.</div>
        </div>
      </div>
    </section>
  );
}
