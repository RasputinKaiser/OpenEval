"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { recentDateRange } from "@/lib/chart-date-range";
import type { ChartSelection } from "@/lib/chart-analysis";

const dateValue = (ms?: number) => ms === undefined ? "" : new Date(ms).toISOString().slice(0, 10);
export function DateRangeControls({ selection, onChange }: { selection: ChartSelection; onChange: (next: ChartSelection) => void }) {
  const [from, setFrom] = useState(dateValue(selection.fromMs));
  const [to, setTo] = useState(dateValue(selection.toMs === undefined ? undefined : selection.toMs - 1));
  const [error, setError] = useState("");
  useEffect(() => { setFrom(dateValue(selection.fromMs)); setTo(dateValue(selection.toMs === undefined ? undefined : selection.toMs - 1)); setError(""); }, [selection.fromMs, selection.toMs]);
  return <form className="flex flex-wrap items-end gap-2" aria-label="Chart date range, UTC" onSubmit={(e) => {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const submittedFrom = String(fields.get("fromDate") ?? from);
    const submittedTo = String(fields.get("throughDate") ?? to);
    const fromMs = submittedFrom ? Date.parse(`${submittedFrom}T00:00:00Z`) : undefined;
    const toMs = submittedTo ? Date.parse(`${submittedTo}T00:00:00Z`) + 86_400_000 : undefined;
    if ((fromMs !== undefined && !Number.isFinite(fromMs)) || (toMs !== undefined && !Number.isFinite(toMs)) || (fromMs !== undefined && toMs !== undefined && fromMs >= toMs)) { setError("Choose an end date on or after the start date."); return; }
    setError(""); onChange({ ...selection, fromMs, toMs });
  }}>
    <div className="flex gap-1 self-end" role="group" aria-label="Recent date presets">
      {([7, 30] as const).map(days => <button key={days} type="button" className="analysis-control" aria-pressed={selection.fromMs === recentDateRange(days).fromMs && selection.toMs === recentDateRange(days).toMs} onClick={() => onChange({ ...selection, ...recentDateRange(days) })}>{days}d</button>)}
    </div>
    <label className="text-xs text-fg-muted">From (UTC)<input className="analysis-input block mt-1" type="date" name="fromDate" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
    <label className="text-xs text-fg-muted">Through (UTC)<input className="analysis-input block mt-1" type="date" name="throughDate" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    <button type="submit" className="analysis-control">Apply dates</button>
    {(selection.fromMs !== undefined || selection.toMs !== undefined) && <button type="button" className="analysis-control" onClick={() => onChange({ ...selection, fromMs: undefined, toMs: undefined })}>All dates</button>}
    {error && <p role="alert" className="basis-full text-xs text-err">{error}</p>}
  </form>;
}

const labels: Record<keyof ChartSelection, string> = { fromMs: "From", toMs: "Before", source: "Source", model: "Model", tool: "Tool", weekday: "Local weekday (Mon=0)", hour: "Local hour", metric: "Distribution", min: "At least", max: "Below", outcome: "Outcome", costSource: "Cost" };
export function SelectionChips({ selection, onChange }: { selection: ChartSelection; onChange: (next: ChartSelection) => void }) {
  const entries = Object.entries(selection).filter(([, value]) => value !== undefined && value !== "");
  if (!entries.length) return null;
  return <div className="flex flex-wrap gap-2 items-center" aria-label="Active chart filters">
    {entries.map(([key, value]) => <button type="button" className="analysis-control max-w-full" key={key} onClick={() => {
      const next = { ...selection }; delete next[key as keyof ChartSelection];
      if (key === "metric") { delete next.min; delete next.max; }
      onChange(next);
    }} aria-label={`Remove ${labels[key as keyof ChartSelection]} filter`}>
      <span className="truncate">{labels[key as keyof ChartSelection]}: {key === "fromMs" || key === "toMs" ? new Date(Number(value)).toISOString().slice(0, 10) : String(value)}</span><X size={12} aria-hidden className="shrink-0" />
    </button>)}
    <button type="button" className="analysis-control" onClick={() => onChange({})}>Reset selection</button>
  </div>;
}
