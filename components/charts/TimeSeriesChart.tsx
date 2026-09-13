"use client";

import { useEffect, useState } from "react";
import { ChartTooltip, useChartTooltip } from "../ChartTooltip";
import { useChartSize } from "./ChartFrame";

export interface TimeSeriesPoint { id: string; label: string; at: number; values: (number | null)[]; detail?: string }
export interface TimeSeries { label: string; color: string }

/** Chronological quantitative chart; null values remain gaps, never invented zeros. */
export function TimeSeriesChart({ points, series, stacked = false, format = String, onExplore }: {
  points: TimeSeriesPoint[]; series: TimeSeries[]; stacked?: boolean; format?: (value: number) => string; onExplore: (id: string) => void;
}) {
  const { ref, width } = useChartSize();

  const { tip, show, hide, showAt, togglePin, unpin } = useChartTooltip();
  const [selected, setInspection] = useState<string | null>(null);
  useEffect(() => {
    const clear = () => setInspection(null);
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") clear(); };
    document.addEventListener("oe-charttip-pin", clear);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("oe-charttip-pin", clear); document.removeEventListener("keydown", escape); };
  }, []);
  const left = 60, right = Math.max(left + 1, width - 20), top = 20, bottom = 180;
  const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
  const max = Math.max(1, ...points.map(p => stacked ? p.values.filter(finite).reduce((a, b) => a + b, 0) : Math.max(0, ...p.values.filter(finite))));
  const minTime = points[0]?.at ?? 0, maxTime = points[points.length - 1]?.at ?? 0;
  const x = (point: TimeSeriesPoint) => maxTime > minTime ? left + (point.at - minTime) / (maxTime - minTime) * (right - left) : (left + right) / 2;
  const y = (v: number) => bottom - v / max * (bottom - top);
  const label = (p: TimeSeriesPoint) => `${p.label} · ${series.map((s, i) => `${s.label}: ${finite(p.values[i]) ? `${p.values[i]!.toLocaleString(undefined, { maximumFractionDigits: 8 })} (${format(p.values[i]!)})` : "Unavailable"}`).join(" · ")}${p.detail ? ` · ${p.detail}` : ""}`;
  const pinned = points.find(p => p.id === selected);
  return <div ref={ref} className="min-w-0" onKeyDown={e => { if (e.key === "Escape") { unpin(); setInspection(null); } }}>
    {!points.length ? <p className="py-8 text-sm text-fg-muted">No dated evidence in this range.</p> : <svg width="100%" height="220" viewBox={`0 0 ${width} 220`} aria-label="Time series; focus a period to inspect its values" role="group">
      {[0, .5, 1].map(t => <g key={t} aria-hidden="true"><line x1={left} x2={right} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-bd)" strokeDasharray="3 5" /><text x={left - 8} y={y(max * t) + 4} textAnchor="end" fill="var(--color-fg-muted)" fontSize="10">{format(max * t)}</text></g>)}
      {!stacked && series.map((s, si) => {
        let path = "", previous = false;
        points.forEach(p => { const v = p.values[si]; if (!finite(v)) { previous = false; return; } path += `${previous ? " L" : " M"}${x(p)},${y(v)}`; previous = true; });
        return <path key={s.label} d={path} fill="none" stroke={s.color} strokeWidth="2" aria-hidden="true" />;
      })}
      {points.map((p, pi) => <g key={p.id} tabIndex={0} role="button" aria-label={label(p)} aria-pressed={selected === p.id} className="time-series-mark"
        onMouseMove={e => show(e, label(p))} onMouseLeave={hide} onFocus={e => showAt(e.currentTarget, label(p))} onBlur={hide}
        onClick={e => { e.stopPropagation(); togglePin(e, label(p), p.id); setInspection(selected === p.id ? null : p.id); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); togglePin({ clientX: 0, clientY: 0, currentTarget: e.currentTarget }, label(p), p.id); setInspection(selected === p.id ? null : p.id); } }}>
        <rect x={x(p) - Math.max(6, Math.min(18, (right - left) / points.length / 2))} y={top} width={Math.max(12, Math.min(36, (right - left) / points.length))} height={bottom - top} fill="transparent" />
        {series.map((s, si) => {
          const value = p.values[si]; if (!finite(value)) return null;
          const before = p.values.slice(0, si).filter(finite).reduce((a, b) => a + b, 0);
          return stacked ? <rect key={s.label} x={x(p) - 5} width="10" y={y(before + value)} height={Math.max(0, y(before) - y(before + value))} fill={s.color} /> : <circle key={s.label} cx={x(p)} cy={y(value)} r={selected === p.id ? 5 : 3} fill={s.color} />;
        })}
        {(pi === 0 || pi === points.length - 1 || pi % Math.max(1, Math.ceil(points.length / (width < 480 ? 3 : 5))) === 0) && <text x={x(p)} y={bottom + 25} textAnchor={pi === 0 ? "start" : pi === points.length - 1 ? "end" : "middle"} fontSize="10" fill="var(--color-fg-muted)">{p.label}</text>}
      </g>)}
    </svg>}
    {!!points.length && <label className="block mt-2 mb-3 text-xs text-fg-muted">Inspect a period<select className="analysis-input block w-full mt-1" value={selected ?? ""} onChange={e => { unpin(); document.dispatchEvent(new CustomEvent("oe-charttip-pin")); setInspection(e.target.value || null); }}><option value="">Choose a period…</option>{points.map(point => <option key={point.id} value={point.id}>{label(point)}</option>)}</select></label>}
    <div className="flex flex-wrap gap-3 text-xs text-fg-muted">{series.map(s => <span key={s.label} style={{ borderLeft: `3px solid ${s.color}`, paddingLeft: 6 }}>{s.label}</span>)}</div>
    {pinned && <div key={pinned.id} className="inspection-receipt flex flex-wrap items-center gap-2 mt-3 text-xs" aria-live="polite"><span>{label(pinned)}</span><button className="analysis-control" onClick={() => onExplore(pinned.id)}>Explore sessions</button><button className="analysis-control" onClick={() => { unpin(); setInspection(null); }}>Clear inspection</button></div>}
    {tip && <ChartTooltip tip={tip} />}
  </div>;
}
