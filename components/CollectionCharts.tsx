"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import type { RollupReport } from "@/lib/collection/rollup";
import type { ToolRollup } from "@/lib/collection/aggregate";
import type { ChartSelection } from "@/lib/chart-analysis";
import { DAYS, fmtNum, fmtNumFull, fmtUsd } from "@/lib/format";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";

/**
 * Interactive Collection-page charts: weekly usage (metric-switchable bars),
 * the when-you-work heatmap, and tool health. Each mark is its own hover/focus
 * hit target with a value-first tooltip; hovered marks lift with a ring.
 */

const RING = "0 0 0 1.5px var(--color-accent-soft)";

// ---- Weekly usage ----

type WeeklyMetric = "cost" | "sessions" | "tokens" | "tools";

const METRICS: Array<{ key: WeeklyMetric; label: string }> = [
  { key: "cost", label: "API equiv." },
  { key: "sessions", label: "Sessions" },
  { key: "tokens", label: "Tokens" },
  { key: "tools", label: "Tool calls" },
];

function weekValue(w: RollupReport["weekly"][number], metric: WeeklyMetric): number {
  switch (metric) {
    case "cost": return w.costUsd;
    case "sessions": return w.sessions;
    case "tokens": return w.inputTokens + w.outputTokens;
    case "tools": return w.toolCalls;
  }
}

function fmtMetric(v: number, metric: WeeklyMetric, estimated: boolean): string {
  return metric === "cost" ? (estimated ? "~" : "") + fmtUsd(v) : fmtNum(v);
}

export function WeeklyUsageChart({ rollup, onExplore }: { rollup: RollupReport; onExplore?: (selection: ChartSelection) => void }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const headingId = useId();
  const [metric, setMetric] = useState<WeeklyMetric>("cost");
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState(Math.max(0, (rollup.weekly?.length ?? 1) - 1));
  const [compareMode, setCompareMode] = useState(false);
  const [baseIdx, setBaseIdx] = useState<number | null>(null);
  const [compareIdx, setCompareIdx] = useState<number | null>(null);

  const weekly = rollup.weekly ?? [];
  const hasWeeklyEvidence = weekly.some((week) => week.sessions > 0);
  const max = Math.max(...weekly.map((w) => weekValue(w, metric)), 1e-9);
  const total = weekly.reduce((sum, week) => sum + weekValue(week, metric), 0);
  const activeIndex = hovered ?? Math.min(selected, Math.max(0, weekly.length - 1));
  const activeWeek = weekly[activeIndex];
  const activeValue = activeWeek ? weekValue(activeWeek, metric) : 0;
  const previousValue = activeIndex > 0 ? weekValue(weekly[activeIndex - 1], metric) : 0;
  const deltaPct = previousValue > 0 ? ((activeValue - previousValue) / previousValue) * 100 : null;
  // Compare-mode numbers: hard deltas between the two user-picked weeks.
  const baseWeek = baseIdx !== null ? weekly[baseIdx] : undefined;
  const compareWeek = compareIdx !== null ? weekly[compareIdx] : undefined;
  const baseValue = baseWeek ? weekValue(baseWeek, metric) : 0;
  const compareValue = compareWeek ? weekValue(compareWeek, metric) : 0;
  const compareDelta = baseWeek && compareWeek && baseValue > 0
    ? ((compareValue - baseValue) / baseValue) * 100
    : null;
  const activeEstimated = metric === "cost" && (activeWeek?.estimatedCostSessions ?? 0) > 0;
  const windowEstimated = metric === "cost" && weekly.some((week) => (week.estimatedCostSessions ?? 0) > 0);
  const AREA = 132; // px — explicit, because %-heights die in nested flex columns
  const activeWeekEnd = activeWeek
    ? weekly[activeIndex + 1]?.startMs ?? (() => { const next = new Date(activeWeek.startMs); next.setDate(next.getDate() + 7); next.setHours(0, 0, 0, 0); return next.getTime(); })()
    : undefined;

  const tipFor = (w: RollupReport["weekly"][number]) => (
    <div className="space-y-0.5">
      <div className="text-fg-dim">week of {w.label}</div>
      {METRICS.map(({ key, label }) => (
        <div key={key} className={clsx("flex justify-between gap-4", key === metric ? "text-fg font-medium" : "text-fg-muted")}>
          <span className="mono tabular-nums">{fmtMetric(weekValue(w, key), key, key === "cost" && (w.estimatedCostSessions ?? 0) > 0)}</span>
          <span>{label.toLowerCase()}</span>
        </div>
      ))}
      {w.estimatedCostSessions > 0 && <div className="pt-1 text-[10px] text-fg-dim">{fmtNum(w.estimatedCostSessions)} sessions use inferred cost evidence</div>}
      {w.childSessions > 0 && <div className="text-[10px] text-fg-dim">{fmtNum(w.childSessions)} child traces included in session count</div>}
    </div>
  );

  if (!hasWeeklyEvidence) {
    return (
      <section className="card min-w-0 overflow-hidden lg:col-span-2" aria-labelledby={headingId}>
        <div className="px-4 pt-4">
          <h2 id={headingId} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">Usage by week</h2>
        </div>
        <div className="m-4 rounded-lg border border-dashed border-bd-subtle bg-bg-elev px-4 py-5 text-sm" role="status">
          <strong className="block text-fg">No weekly usage evidence in this snapshot</strong>
          <span className="mt-1 block text-[11px] leading-snug text-fg-dim">The report contains zero observed session starts in the visible window, so the zero-filled calendar buckets are not drawn as measured usage.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="card min-w-0 overflow-hidden lg:col-span-2" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 flex-wrap">
        <div>
          <h2 id={headingId} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">
            Usage by week{metric === "cost" && windowEstimated ? " — API-list equivalent" : ""}
          </h2>
          <p className="mt-1 text-[11px] text-fg-dim">
            Scale: <span className="mono text-fg-muted">{metric === "cost" ? "USD · API equivalent" : metric === "sessions" ? "sessions" : metric === "tokens" ? "tokens" : "tool calls"}</span> ·{" "}
            {compareMode ? "pick the base week, then one to measure against it." : "select a week for its complete usage mix."}
            {compareMode && (
              <span className="ml-2 inline-flex items-center gap-2 whitespace-nowrap align-baseline">
                <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: "var(--color-accent)" }} /> base</span>
                <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: "var(--color-ok)" }} /> compared</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-lg border border-bd-subtle bg-bg p-1" role="group" aria-label="Weekly metric">
          {METRICS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
              className={clsx(
                "min-h-11 shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-medium outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent",
                metric === key
                  ? "bg-bg-elev text-accent-soft shadow-sm"
                  : "text-fg-dim hover:text-fg hover:bg-bg-subtle",
              )}
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            aria-pressed={compareMode}
            onClick={() => { setCompareMode((v) => !v); setBaseIdx(null); setCompareIdx(null); }}
            title={compareMode ? "Exit compare mode" : "Compare two weeks: pick a base, then a week to measure against it"}
            className={clsx(
              "min-h-11 shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-medium outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent",
              compareMode ? "bg-bg-elev text-accent-soft shadow-sm" : "text-fg-dim hover:text-fg hover:bg-bg-subtle",
            )}
          >
            Compare
          </button></div>
      </div>

      <div aria-live="polite" className="mx-4 mt-3 grid grid-cols-1 gap-y-0 divide-y sm:divide-y-0 sm:grid-cols-3 sm:divide-x divide-bd-subtle rounded-lg border border-bd-subtle bg-bg" style={{ background: "color-mix(in srgb, var(--color-bg) 64%, var(--color-bg-subtle))" }}>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">Selected week</div>
          <div className={clsx("mt-0.5 truncate rounded px-1 -mx-1 text-lg font-semibold mono tabular-nums transition-colors duration-150", hovered !== null ? "text-accent-soft" : undefined)}>{fmtMetric(activeValue, metric, activeEstimated)}</div>
          <div className="truncate text-[10px] text-fg-dim mono">{activeWeek?.label ?? "No data"}</div>
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">
            {baseWeek && compareWeek ? "Compared weeks" : compareMode ? "Compare mode" : "vs prior week"}
          </div>
          {baseWeek && compareWeek ? (
            <>
              <div className={clsx("mt-0.5 text-lg font-semibold mono tabular-nums", compareDelta !== null && compareDelta < 0 ? "text-fg-muted" : "text-accent-soft")}>
                {compareDelta === null ? "—" : `${compareDelta >= 0 ? "+" : ""}${compareDelta.toFixed(0)}%`}
              </div>
              <div className="truncate text-[10px] text-fg-dim mono">
                {fmtMetric(baseValue, metric, metric === "cost" && (baseWeek.estimatedCostSessions ?? 0) > 0)} → {fmtMetric(compareValue, metric, metric === "cost" && (compareWeek.estimatedCostSessions ?? 0) > 0)}
              </div>
            </>
          ) : compareMode ? (
            <>
              <div className="mt-0.5 text-lg font-semibold text-fg-dim">—</div>
              <div className="truncate text-[10px] text-fg-dim">{baseIdx === null ? "pick the base week" : "pick a week to compare"}</div>
            </>
          ) : (
            <>
              <div className={clsx("mt-0.5 text-lg font-semibold mono tabular-nums", deltaPct !== null && deltaPct < 0 ? "text-fg-muted" : "text-accent-soft")}>
                {deltaPct === null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%`}
              </div>
              <div className="truncate text-[10px] text-fg-dim">week over week</div>
            </>
          )}
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">{weekly.length}w total</div>
          <div className="mt-0.5 truncate text-lg font-semibold mono tabular-nums">{fmtMetric(total, metric, windowEstimated)}</div>
          <div className="truncate text-[10px] text-fg-dim">full visible window</div>
        </div>
      </div>

      {activeWeek && onExplore && activeWeekEnd && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bd-subtle bg-bg-subtle/40 px-3 py-2 text-[11px]">
          <span className="text-fg-dim">Inspection is pinned to {activeWeek.label}; apply its local calendar week to the full collection.</span>
          <button type="button" className="analysis-control" onClick={() => onExplore({ fromMs: activeWeek.startMs, toMs: activeWeekEnd })}>Explore this week</button>
        </div>
      )}

      <div
        className="chart-scroll-well scroll-contain overflow-x-auto px-4 pb-4 pt-3"
        role="group"
        aria-label={`Weekly usage chart in ${metric === "cost" ? "USD API-equivalent" : metric}`}
        onMouseLeave={() => { hide(); setHovered(null); }}
      >
        <div className="relative h-[174px] min-w-[520px] lg:min-w-0">
          {[0, 0.5, 1].map((ratio) => (
            <div
              key={ratio}
              className="pointer-events-none absolute inset-x-0 border-t border-bd-subtle"
              style={{ bottom: `${30 + ratio * AREA}px` }}
            >
              {ratio > 0 && (
                <span className="absolute -top-3 right-0 rounded-sm bg-bg-subtle pl-1 text-[9px] text-fg-dim mono tabular-nums">
                  {fmtMetric(max * ratio, metric, windowEstimated)}
                </span>
              )}
            </div>
          ))}
          <div className="absolute inset-x-0 bottom-0 top-2 flex items-end gap-1.5">
            {weekly.map((w, i) => {
              const v = weekValue(w, metric);
              const active = activeIndex === i;
              return (
                <button
                  key={w.startMs}
                  type="button"
                  className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`Week of ${w.label}: ${fmtMetric(v, metric, (w.estimatedCostSessions ?? 0) > 0)}${compareMode && baseIdx === i ? " — base week" : compareMode && compareIdx === i ? " — comparison week" : ""}`}
                  aria-pressed={selected === i}
                  onMouseMove={(e) => { show(e, tipFor(w)); setHovered(i); }}
                  onFocus={(e) => { showAt(e.currentTarget, tipFor(w)); setHovered(i); }}
                  onBlur={() => { hide(); setHovered(null); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (compareMode) {
                      // Compare flow: first click picks the base week, second picks the week
                      // to measure against it, further clicks re-pick the comparison target.
                      if (baseIdx === null || (baseIdx !== null && compareIdx !== null)) {
                        setBaseIdx(i);
                        setCompareIdx(null);
                      } else if (i !== baseIdx) {
                        setCompareIdx(i);
                      }
                      return;
                    }
                    setSelected(i);
                    togglePin(e, tipFor(w), `week-${w.startMs}`);
                  }}
                >
                  <span className="flex h-[132px] w-full items-end justify-center">
                    <span
                      className="chart-grow-y block w-[70%] min-w-[8px] rounded-t-[5px] transition-[background-color,box-shadow,transform] duration-100 group-hover:-translate-y-0.5 motion-reduce:transition-none"
                      style={{
                        "--grow-index": i,
                        height: `${v > 0 ? Math.max(3, Math.round((v / max) * AREA)) : 1}px`,
                        background: compareMode && (baseIdx === i || compareIdx === i)
                          ? `color-mix(in srgb, ${compareIdx === i ? "var(--color-ok)" : "var(--color-accent)"} ${active ? 88 : 70}%, transparent)`
                          : `color-mix(in srgb, var(--color-accent) ${active ? 88 : 48}%, transparent)`,
                        boxShadow: active || (compareMode && (baseIdx === i || compareIdx === i)) ? RING : undefined,
                      } as React.CSSProperties}
                    />
                  </span>
                  <time
                    dateTime={new Date(w.startMs).toISOString()}
                    className={clsx("mt-1 h-6 w-full truncate text-center text-[10px] mono", active ? "text-fg" : "text-fg-dim")}
                  >
                    {w.label}
                  </time>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <ChartTooltip tip={tip} />
    </section>
  );
}

// ---- Activity heatmap ----


export function ActivityHeatmap({ heatmap, totalSessions, onExplore }: { heatmap: number[][]; totalSessions: number; onExplore?: (selection: ChartSelection) => void }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const headingId = useId();
  const [hovered, setHovered] = useState<{ d: number; h: number } | null>(null);
  const [selected, setSelected] = useState<{ d: number; h: number } | null>(null);
  const hasActivityEvidence = totalSessions > 0 && heatmap.some((row) => row.some((value) => Number.isFinite(value) && value > 0));

  if (!hasActivityEvidence) {
    return (
      <section className="card min-w-0 overflow-hidden lg:col-span-2" aria-labelledby={headingId}>
        <div className="px-4 pt-4">
          <h2 id={headingId} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">When you work — session starts</h2>
        </div>
        <div className="m-4 rounded-lg border border-dashed border-bd-subtle bg-bg-elev px-4 py-5 text-sm" role="status">
          <strong className="block text-fg">No session-start evidence in this snapshot</strong>
          <span className="mt-1 block text-[11px] leading-snug text-fg-dim">The heatmap stays empty until at least one observed session start is available; an empty grid is not a claim that every hour was measured.</span>
        </div>
      </section>
    );
  }

  const maxCell = Math.max(1, ...heatmap.map((row) => Math.max(...row)));
  let peak = { d: 0, h: 0, v: 0 };
  heatmap.forEach((row, d) => row.forEach((v, h) => {
    if (v > peak.v) peak = { d, h, v };
  }));
  const active = hovered ?? selected ?? peak;
  const activeValue = heatmap[active.d]?.[active.h] ?? 0;
  const activeShare = totalSessions > 0 ? (activeValue / totalSessions) * 100 : 0;

  const tipFor = (d: number, h: number, v: number) => (
    <div>
      <span className="font-medium">{v}</span>
      <span className="text-fg-muted"> session{v === 1 ? "" : "s"}</span>
      <div className="text-fg-dim mono">{DAYS[d]} {String(h).padStart(2, "0")}:00–{String((h + 1) % 24).padStart(2, "0")}:00</div>
    </div>
  );

  return (
    <section className="card min-w-0 overflow-hidden lg:col-span-2" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h2 id={headingId} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">When you work — session starts</h2>
          <p className="mt-1 text-[11px] text-fg-dim">Local time · select any cell for an exact count.</p>
        </div>
        <span className="shrink-0 rounded-full border border-bd-subtle bg-bg px-2.5 py-1 text-[10px] text-fg-dim mono">{fmtNum(totalSessions)} starts</span>
      </div>

      <div className="mx-4 mt-3 flex items-center justify-between gap-4 rounded-lg border border-bd-subtle bg-bg px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--color-bg) 64%, var(--color-bg-subtle))" }}>
        <div className="min-w-0" aria-live="polite">
          <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">Selected hour</div>
          <div className={clsx("mt-0.5 truncate rounded px-1 -mx-1 text-base font-semibold transition-colors duration-150", hovered !== null ? "text-accent-soft" : undefined)}>
            {DAYS[active.d]} <span className="mono tabular-nums">{String(active.h).padStart(2, "0")}:00–{String((active.h + 1) % 24).padStart(2, "0")}:00</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold mono tabular-nums">{fmtNum(activeValue)}</div>
          <div className="text-[10px] text-fg-dim mono">{activeShare.toFixed(activeShare < 1 ? 1 : 0)}% of starts</div>
        </div>
      </div>

      {selected && onExplore && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bd-subtle bg-bg-subtle/40 px-3 py-2 text-[11px]">
          <span className="text-fg-dim">Pinned {DAYS[selected.d]} at {String(selected.h).padStart(2, "0")}:00 local time.</span>
          <button type="button" className="analysis-control" onClick={() => onExplore({ weekday: selected.d, hour: selected.h })}>Explore this hour</button>
        </div>
      )}

      <div
        className="chart-scroll-well scroll-contain overflow-x-auto px-4 pb-4 pt-3"
        role="group"
        aria-label="Session starts by local day and hour"
        onMouseLeave={() => { hide(); setHovered(null); }}
      >
        <div className="min-w-[520px] space-y-1 lg:min-w-0">
          {heatmap.map((row, d) => (
            <div key={d} className="grid items-center gap-1" role="group" aria-label={`${DAYS[d]} session starts by hour`} style={{ gridTemplateColumns: "34px repeat(24, minmax(14px, 1fr))" }}>
              <span className={clsx("text-[9px] mono transition-colors", active.d === d ? "text-fg" : "text-fg-dim")}>{DAYS[d]}</span>
              {row.map((v, h) => {
                const isActive = active.d === d && active.h === h;
                return (
                  <button
                    key={h}
                    type="button"
                    className={clsx("heatmap-cell chart-fade-in h-[18px] min-w-0 rounded-[3px] outline-none transition-[box-shadow,transform] duration-75 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-accent", v === 0 && "bg-bg-elev")}
                    aria-label={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 — ${v} session${v === 1 ? "" : "s"}`}
                    aria-pressed={selected?.d === d && selected?.h === h}
                    onMouseMove={(e) => { setHovered({ d, h }); show(e, tipFor(d, h, v)); }}
                    onFocus={(e) => {
                      setHovered({ d, h });
                      setSelected({ d, h });
                      showAt(e.currentTarget, tipFor(d, h, v));
                    }}
                    onBlur={() => { hide(); setHovered(null); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected({ d, h });
                      togglePin(e, tipFor(d, h, v), `hm-${d}-${h}`);
                    }}
                    style={{
                      background: v > 0
                        ? `color-mix(in srgb, var(--color-accent) ${Math.round(16 + 84 * (v / maxCell))}%, transparent)`
                        : undefined,
                      boxShadow: isActive ? RING : undefined,
                    }}
                  />
                );
              })}
            </div>
          ))}
          <div className="flex items-center justify-between pl-[38px] pt-1 text-[9px] text-fg-dim">
            <span>Local hour</span>
            <span className="mono">00–23</span>
          </div>
          <div className="grid items-center gap-1" style={{ gridTemplateColumns: "34px repeat(24, minmax(14px, 1fr))" }}>
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className={clsx("text-center text-[9px] mono min-w-0 transition-colors", active.h === h ? "text-fg" : "text-fg-dim")}>
                {active.h === h ? h : h % 6 === 0 ? h : ""}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-end gap-1 pt-1 text-[9px] text-fg-dim">
            <span className="mr-1">Less</span>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <span
                key={ratio}
                className="h-2.5 min-w-[14px] w-5 rounded-[2px]"
                style={{ background: ratio === 0 ? "var(--color-bg-elev)" : `color-mix(in srgb, var(--color-accent) ${Math.round(16 + 84 * ratio)}%, transparent)` }}
              />
            ))}
            <span className="ml-1">More</span>
          </div>
        </div>
      </div>
      <ChartTooltip tip={tip} />
    </section>
  );
}

// ---- Tool health ----

export function ToolHealthList({ tools, fullWidth, hideHeading, onExplore }: { tools: ToolRollup[]; fullWidth?: boolean; hideHeading?: boolean; onExplore?: (selection: ChartSelection) => void }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const headingId = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const maxCalls = tools[0]?.calls || 1;

  if (tools.length === 0) {
    return (
      <section className={clsx("card p-4", fullWidth && "lg:col-span-3")} aria-labelledby={hideHeading ? undefined : headingId} aria-label={hideHeading ? "Tool health" : undefined}>
        {!hideHeading && <h2 id={headingId} className="mb-2 text-[11px] uppercase tracking-[0.12em] text-fg-muted">Tool health — top tools</h2>}
        <div className="rounded-lg border border-dashed border-bd-subtle bg-bg-elev px-3 py-4 text-sm" role="status">
          <strong className="block text-fg">No tool-call evidence in this snapshot</strong>
          <span className="mt-1 block text-[11px] leading-snug text-fg-dim">Tool health is unavailable until a retained session contains an observed tool call.</span>
        </div>
      </section>
    );
  }

  const tipFor = (t: ToolRollup) => {
    const errPct = t.calls ? (t.errors / t.calls) * 100 : 0;
    return (
      <div className="space-y-0.5">
        <div className="font-medium mono">{t.name}</div>
        <div className="text-fg-muted mono tabular-nums">{fmtNumFull(t.calls)} calls</div>
        <div className={clsx("mono tabular-nums", errPct >= 5 ? "text-err" : "text-fg-muted")}>
          {fmtNumFull(t.errors)} errors ({errPct.toFixed(1)}%)
        </div>
      </div>
    );
  };

  return (
    <section className={clsx("card p-4", fullWidth && "lg:col-span-3")} aria-labelledby={hideHeading ? undefined : headingId} aria-label={hideHeading ? "Tool health" : undefined}>
      {!hideHeading && <h2 id={headingId} className="mb-2 text-[11px] uppercase tracking-[0.12em] text-fg-muted">Tool health — top tools</h2>}
      <div
        className={clsx(fullWidth ? "grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5" : "space-y-0.5")}
        onMouseLeave={() => { hide(); setHovered(null); }}
      >
        {tools.map((t) => {
          const errPct = t.calls ? (t.errors / t.calls) * 100 : 0;
          const active = hovered === t.name;
          return (
            <button
              key={t.name}
              type="button"
              className={clsx("-mx-1.5 block min-h-10 w-full rounded px-1.5 py-2 text-left text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", active && "bg-bg-elev")}
              aria-pressed={selected === t.name}
              onMouseMove={(e) => { show(e, tipFor(t)); setHovered(t.name); }}
              onFocus={(e) => { showAt(e.currentTarget, tipFor(t)); setHovered(t.name); }}
              onBlur={() => { hide(); setHovered(null); }}
              onClick={(e) => { e.stopPropagation(); setSelected(selected === t.name ? null : t.name); togglePin(e, tipFor(t), `tool-${t.name}`); }}
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className={clsx("truncate mono text-[11px]", active ? "text-fg" : "text-fg-muted")}>{t.name}</span>
                <span className="mono tabular-nums shrink-0 text-[11px]">
                  {fmtNum(t.calls)}
                  {t.errors > 0 && <span className={errPct >= 5 ? "text-err" : "text-fg-dim"}> · {errPct.toFixed(errPct >= 10 ? 0 : 1)}% failed</span>}
                </span>
              </div>
              <div
                className="h-[3px] rounded-full mt-0.5 transition-[width,background] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${Math.max(2, (t.calls / maxCalls) * 100)}%`,
                  background: `color-mix(in srgb, var(--color-accent) ${active ? 70 : 45}%, transparent)`,
                }}
              />
            </button>
          );
        })}
      </div>
      {selected && onExplore && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-bd-subtle pt-3 text-[11px]">
          <span className="text-fg-dim">Pinned tool: <span className="mono text-fg-muted">{selected}</span></span>
          <button type="button" className="analysis-control" onClick={() => onExplore({ tool: selected })}>Explore this tool</button>
        </div>
      )}
      <ChartTooltip tip={tip} />
    </section>
  );
}
