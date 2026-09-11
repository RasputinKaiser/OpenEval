"use client";

import { useEffect, useState } from "react";
import { ChartTooltip, useChartTooltip } from "../ChartTooltip";
export interface AnalysisBar { id: string; label: string; value: number; detail?: string; tone?: "ok" | "err" | "warn" | "accent"; }

export function SelectableBars({ rows, format = String, onExplore, noun = "sessions", selectedId }: {
  rows: AnalysisBar[]; format?: (value: number) => string; onExplore?: (id: string) => void; noun?: string; selectedId?: string;
}) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const { tip, show, showAt, hide, togglePin, unpin } = useChartTooltip();
  const pinned = rows.find((r) => r.id === pinnedId);
  const max = Math.max(1, ...rows.map((r) => Number.isFinite(r.value) ? Math.abs(r.value) : 0));
  useEffect(() => { if (!rows.some((r) => r.id === pinnedId)) setPinnedId(null); }, [rows, pinnedId]);
  const visible = all ? rows : rows.slice(0, 12);
  if (!rows.length) return <p className="py-4 text-sm text-fg-muted">No matching evidence to plot.</p>;
  return <div onKeyDown={(e) => { if (e.key === "Escape") { setPinnedId(null); unpin(); } }}>
    <div className="space-y-1" aria-label="Selectable chart values">
      {visible.map((row) => {
        const content = `${row.label}: ${format(row.value)}${row.detail ? ` · ${row.detail}` : ""}`;
        return <button key={row.id} type="button" className="analysis-bar" aria-label={content} aria-pressed={pinnedId === row.id || selectedId === row.id}
          onMouseMove={(e) => show(e, content)} onMouseLeave={hide} onFocus={(e) => showAt(e.currentTarget, content)} onBlur={hide}
          onClick={(e) => { e.stopPropagation(); setPinnedId(pinnedId === row.id ? null : row.id); togglePin(e, content, row.id); }}>
          <span className="min-w-0 text-left"><span className="block truncate">{row.label}</span>{row.detail && <span className="block truncate text-[11px] text-fg-muted">{row.detail}</span>}</span>
          <span className="analysis-bar__track" aria-hidden><span style={{ width: `${Number.isFinite(row.value) ? Math.abs(row.value) / max * 100 : 0}%`, background: `var(--color-${row.tone ?? "accent"})` }} /></span>
          <span className="mono text-right text-xs">{format(row.value)}</span>
        </button>;
      })}
    </div>
    {rows.length > 12 && <button className="analysis-control mt-2" type="button" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
    {pinned && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" aria-live="polite"><span className="break-words min-w-0">{pinned.label} · {format(pinned.value)}</span>{onExplore && <button type="button" className="analysis-control" onClick={() => onExplore(pinned.id)}>Explore these {noun}</button>}<button type="button" className="analysis-control" onClick={() => { setPinnedId(null); unpin(); }}>Clear inspection</button></div>}
    {tip && <ChartTooltip tip={tip} />}
  </div>;
}
