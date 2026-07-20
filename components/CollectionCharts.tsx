"use client";

import { useState } from "react";
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
  const [metric, setMetric] = useState<WeeklyMetric>("cost");
  const [hovered, setHovered] = useState<number | null>(null);

  const weekly = rollup.weekly ?? [];
  const max = Math.max(...weekly.map((w) => weekValue(w, metric)), 1e-9);
  const AREA = 96; // px — explicit, because %-heights die in nested flex columns

  const tipFor = (w: RollupReport["weekly"][number]) => (
    <div className="space-y-0.5">
      <div className="text-fg-dim">week of {w.label}</div>
      {METRICS.map(({ key, label }) => (
        <div key={key} className={clsx("flex justify-between gap-4", key === metric ? "text-fg font-medium" : "text-fg-muted")}>
          <span className="mono tabular-nums">{fmtMetric(weekValue(w, key), key, rollup.anyEstimatedCost)}</span>
          <span>{label.toLowerCase()}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="card p-4 lg:col-span-2">
      <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-[11px] uppercase tracking-wider text-fg-muted">
          Usage by week{metric === "cost" && rollup.anyEstimatedCost ? " — API-list equivalent" : ""}
        </h2>
        <div className="flex items-center gap-1" role="tablist" aria-label="Weekly metric">
          {METRICS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={metric === key}
              onClick={() => setMetric(key)}
              className={clsx(
                "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                metric === key ? "bg-accent/10 text-accent-soft" : "text-fg-dim hover:text-fg hover:bg-bg-elev",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1" onMouseLeave={() => { hide(); setHovered(null); }}>
        {weekly.map((w, i) => {
          const v = weekValue(w, metric);
          return (
            <button
              key={w.startMs}
              type="button"
              className="flex-1 flex flex-col items-center gap-1 min-w-0 outline-none"
              aria-label={`Week of ${w.label}: ${fmtMetric(v, metric, rollup.anyEstimatedCost)}`}
              onMouseMove={(e) => { show(e, tipFor(w)); setHovered(i); }}
              onFocus={(e) => { showAt(e.currentTarget, tipFor(w)); setHovered(i); }}
              onBlur={() => { hide(); setHovered(null); }}
              onClick={(e) => { e.stopPropagation(); togglePin(e, tipFor(w), `week-${w.startMs}`); }}
            >
              <div
                className="w-full rounded-t-[4px] transition-[background,box-shadow] duration-100"
                style={{
                  height: `${v > 0 ? Math.max(3, Math.round((v / max) * AREA)) : 1}px`,
                  background: `color-mix(in srgb, var(--color-accent) ${hovered === i ? 80 : 55}%, transparent)`,
                  boxShadow: hovered === i ? RING : undefined,
                }}
              />
              <span className={clsx("text-[9px] mono truncate w-full text-center", hovered === i ? "text-fg" : "text-fg-dim")}>{w.label}</span>
            </button>
          );
        })}
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}

// ---- Activity heatmap ----


export function ActivityHeatmap({ heatmap, totalSessions }: { heatmap: number[][]; totalSessions: number }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
  const [cell, setCell] = useState<{ d: number; h: number } | null>(null);

  const maxCell = Math.max(1, ...heatmap.map((row) => Math.max(...row)));

  const tipFor = (d: number, h: number, v: number) => (
    <div>
      <span className="font-medium">{v}</span>
      <span className="text-fg-muted"> session{v === 1 ? "" : "s"}</span>
      <div className="text-fg-dim mono">{DAYS[d]} {String(h).padStart(2, "0")}:00–{String((h + 1) % 24).padStart(2, "0")}:00</div>
    </div>
  );

  return (
    <div className="card p-4 lg:col-span-2">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-wider text-fg-muted">When you work — session starts</h2>
        <span className="text-[10px] text-fg-dim mono">{fmtNum(totalSessions)} sessions, full history</span>
      </div>
      <div className="space-y-[3px]" onMouseLeave={() => { hide(); setCell(null); }}>
        {heatmap.map((row, d) => (
          <div key={d} className="flex items-center gap-[3px]">
            <span className={clsx("w-8 text-[9px] mono shrink-0 transition-colors", cell?.d === d ? "text-fg" : "text-fg-dim")}>{DAYS[d]}</span>
            {row.map((v, h) => {
              const active = cell?.d === d && cell?.h === h;
              return (
                <button
                  key={h}
                  type="button"
                  className={clsx("flex-1 h-[11px] rounded-[2px] min-w-0 transition-[box-shadow] duration-75 outline-none", v === 0 && "bg-bg-elev")}
                  aria-label={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 — ${v} session${v === 1 ? "" : "s"}`}
                  onMouseMove={(e) => { setCell({ d, h }); show(e, tipFor(d, h, v)); }}
                  onFocus={(e) => { setCell({ d, h }); showAt(e.currentTarget, tipFor(d, h, v)); }}
                  onBlur={() => { hide(); setCell(null); }}
                  onClick={(e) => { e.stopPropagation(); togglePin(e, tipFor(d, h, v), `hm-${d}-${h}`); }}
                  style={{
                    background: v > 0
                      ? `color-mix(in srgb, var(--color-accent) ${Math.round(18 + 82 * (v / maxCell))}%, transparent)`
                      : undefined,
                    boxShadow: active ? RING : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-[3px]">
          <span className="w-8 shrink-0" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className={clsx("flex-1 text-center text-[8px] mono min-w-0 transition-colors", cell?.h === h ? "text-fg" : "text-fg-dim")}>
              {cell?.h === h ? h : h % 6 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}

// ---- Tool health ----

export function ToolHealthList({ tools, fullWidth, hideHeading }: { tools: ToolRollup[]; fullWidth?: boolean; hideHeading?: boolean }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();
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
    <div className={clsx("card p-4", fullWidth && "lg:col-span-3")}>
      {!hideHeading && <h2 className="text-[11px] uppercase tracking-wider text-fg-muted mb-2">Tool health — top tools</h2>}
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
              className={clsx("block w-full text-left text-[12px] rounded px-1.5 py-1 -mx-1.5 outline-none transition-colors", active && "bg-bg-elev")}
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
    </div>
  );
}
