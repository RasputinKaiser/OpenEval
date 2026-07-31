"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import type { RollupReport } from "@/lib/collection/rollup";
import type { ToolRollup } from "@/lib/collection/aggregate";
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

export function WeeklyUsageChart({ rollup }: { rollup: RollupReport }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const headingId = useId();
  const [metric, setMetric] = useState<WeeklyMetric>("cost");
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState(Math.max(0, (rollup.weekly?.length ?? 1) - 1));

  const weekly = rollup.weekly ?? [];
  const max = Math.max(...weekly.map((w) => weekValue(w, metric)), 1e-9);
  const total = weekly.reduce((sum, week) => sum + weekValue(week, metric), 0);
  const activeIndex = hovered ?? Math.min(selected, Math.max(0, weekly.length - 1));
  const activeWeek = weekly[activeIndex];
  const activeValue = activeWeek ? weekValue(activeWeek, metric) : 0;
  const previousValue = activeIndex > 0 ? weekValue(weekly[activeIndex - 1], metric) : 0;
  const deltaPct = previousValue > 0 ? ((activeValue - previousValue) / previousValue) * 100 : null;
  const activeEstimated = metric === "cost" && (activeWeek?.estimatedCostSessions ?? 0) > 0;
  const windowEstimated = metric === "cost" && weekly.some((week) => (week.estimatedCostSessions ?? 0) > 0);
  const AREA = 132; // px — explicit, because %-heights die in nested flex columns

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

  return (
    <section className="card overflow-hidden lg:col-span-2" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 flex-wrap">
        <div>
          <h2 id={headingId} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">
            Usage by week{metric === "cost" && rollup.anyEstimatedCost ? " — API-list equivalent" : ""}
          </h2>
          <p className="mt-1 text-[11px] text-fg-dim">
            Scale: <span className="mono text-fg-muted">{metric === "cost" ? "USD · API equivalent" : metric === "sessions" ? "sessions" : metric === "tokens" ? "tokens" : "tool calls"}</span> · select a week for its complete usage mix.
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
                "min-h-9 shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-medium outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent",
                metric === key
                  ? "bg-bg-elev text-accent-soft shadow-sm"
                  : "text-fg-dim hover:text-fg hover:bg-bg-subtle",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-3 divide-x divide-bd-subtle rounded-lg border border-bd-subtle bg-bg" style={{ background: "color-mix(in srgb, var(--color-bg) 64%, var(--color-bg-subtle))" }}>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-wider text-fg-dim">Selected week</div>
          <div className="mt-0.5 truncate text-lg font-semibold mono tabular-nums">{fmtMetric(activeValue, metric, activeEstimated)}</div>
          <div className="truncate text-[10px] text-fg-dim mono">{activeWeek?.label ?? "No data"}</div>
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-wider text-fg-dim">vs prior</div>
          <div className={clsx("mt-0.5 text-lg font-semibold mono tabular-nums", deltaPct !== null && deltaPct < 0 ? "text-fg-muted" : "text-accent-soft")}>
            {deltaPct === null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%`}
          </div>
          <div className="truncate text-[10px] text-fg-dim">week over week</div>
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-wider text-fg-dim">{weekly.length}w total</div>
          <div className="mt-0.5 truncate text-lg font-semibold mono tabular-nums">{fmtMetric(total, metric, windowEstimated)}</div>
          <div className="truncate text-[10px] text-fg-dim">full visible window</div>
        </div>
      </div>

      <div className="scroll-contain overflow-x-auto px-4 pb-4 pt-3" role="group" aria-label={`Weekly usage chart in ${metric === "cost" ? "USD API-equivalent" : metric}`} onMouseLeave={() => { hide(); setHovered(null); }}>
        <div className="relative h-[174px] min-w-[520px] lg:min-w-0">
          {[0, 0.5, 1].map((ratio) => (
            <div
              key={ratio}
              className="pointer-events-none absolute inset-x-0 border-t border-bd-subtle"
              style={{ bottom: `${30 + ratio * AREA}px` }}
            >
              {ratio > 0 && (
                <span className="absolute -top-3 right-0 rounded-sm bg-bg-subtle pl-1 text-[8px] text-fg-dim mono tabular-nums">
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
                  aria-label={`Week of ${w.label}: ${fmtMetric(v, metric, (w.estimatedCostSessions ?? 0) > 0)}`}
                  aria-pressed={selected === i}
                  onMouseMove={(e) => { show(e, tipFor(w)); setHovered(i); }}
                  onFocus={(e) => { showAt(e.currentTarget, tipFor(w)); setHovered(i); }}
                  onBlur={() => { hide(); setHovered(null); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(i);
                    togglePin(e, tipFor(w), `week-${w.startMs}`);
                  }}
                >
                  <span className="flex h-[132px] w-full items-end justify-center">
                    <span
                      className="block w-[70%] min-w-[8px] rounded-t-[5px] transition-[background-color,box-shadow,transform] duration-100 group-hover:-translate-y-0.5"
                      style={{
                        height: `${v > 0 ? Math.max(3, Math.round((v / max) * AREA)) : 1}px`,
                        background: `color-mix(in srgb, var(--color-accent) ${active ? 88 : 48}%, transparent)`,
                        boxShadow: active ? RING : undefined,
                      }}
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


export function ActivityHeatmap({ heatmap, totalSessions }: { heatmap: number[][]; totalSessions: number }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const headingId = useId();
  const [hovered, setHovered] = useState<{ d: number; h: number } | null>(null);
  const [selected, setSelected] = useState<{ d: number; h: number } | null>(null);

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
    <section className="card overflow-hidden lg:col-span-2" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h2 id={headingId} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">When you work — session starts</h2>
          <p className="mt-1 text-[11px] text-fg-dim">Local time · select any cell for an exact count.</p>
        </div>
        <span className="shrink-0 rounded-full border border-bd-subtle bg-bg px-2.5 py-1 text-[10px] text-fg-dim mono">{fmtNum(totalSessions)} starts</span>
      </div>

      <div className="mx-4 mt-3 flex items-center justify-between gap-4 rounded-lg border border-bd-subtle bg-bg px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--color-bg) 64%, var(--color-bg-subtle))" }}>
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-fg-dim">Selected hour</div>
          <div className="mt-0.5 truncate text-base font-semibold">
            {DAYS[active.d]} <span className="mono tabular-nums">{String(active.h).padStart(2, "0")}:00–{String((active.h + 1) % 24).padStart(2, "0")}:00</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold mono tabular-nums">{fmtNum(activeValue)}</div>
          <div className="text-[10px] text-fg-dim mono">{activeShare.toFixed(activeShare < 1 ? 1 : 0)}% of starts</div>
        </div>
      </div>

      <div className="scroll-contain overflow-x-auto px-4 pb-4 pt-3" role="group" aria-label="Session starts by local day and hour" onMouseLeave={() => { hide(); setHovered(null); }}>
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
                    className={clsx("h-[18px] min-w-0 rounded-[3px] outline-none transition-[box-shadow,transform] duration-75 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-accent", v === 0 && "bg-bg-elev")}
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
              <span key={h} className={clsx("text-center text-[8px] mono min-w-0 transition-colors", active.h === h ? "text-fg" : "text-fg-dim")}>
                {active.h === h ? h : h % 6 === 0 ? h : ""}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-end gap-1 pt-1 text-[9px] text-fg-dim">
            <span className="mr-1">Less</span>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <span
                key={ratio}
                className="h-2.5 w-5 rounded-[2px]"
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

export function ToolHealthList({ tools, fullWidth, hideHeading }: { tools: ToolRollup[]; fullWidth?: boolean; hideHeading?: boolean }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const headingId = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const maxCalls = tools[0]?.calls || 1;

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
      {!hideHeading && <h2 id={headingId} className="mb-2 text-[11px] uppercase tracking-wider text-fg-muted">Tool health — top tools</h2>}
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
              onMouseMove={(e) => { show(e, tipFor(t)); setHovered(t.name); }}
              onFocus={(e) => { showAt(e.currentTarget, tipFor(t)); setHovered(t.name); }}
              onBlur={() => { hide(); setHovered(null); }}
              onClick={(e) => { e.stopPropagation(); togglePin(e, tipFor(t), `tool-${t.name}`); }}
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className={clsx("truncate mono text-[11px]", active ? "text-fg" : "text-fg-muted")}>{t.name}</span>
                <span className="mono tabular-nums shrink-0 text-[11px]">
                  {fmtNum(t.calls)}
                  {t.errors > 0 && <span className={errPct >= 5 ? "text-err" : "text-fg-dim"}> · {errPct.toFixed(errPct >= 10 ? 0 : 1)}%✗</span>}
                </span>
              </div>
              <div
                className="h-[3px] rounded-full mt-0.5 transition-[background]"
                style={{
                  width: `${Math.max(2, (t.calls / maxCalls) * 100)}%`,
                  background: `color-mix(in srgb, var(--color-accent) ${active ? 70 : 45}%, transparent)`,
                }}
              />
            </button>
          );
        })}
      </div>
      <ChartTooltip tip={tip} />
    </section>
  );
}
