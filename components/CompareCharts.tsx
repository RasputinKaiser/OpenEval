"use client";

import { useEffect, useState } from "react";
import { ChartFrame } from "./charts/ChartFrame";
import { PairedValues } from "./charts/PairedValues";
import { comparisonDelta, comparisonKey, transitionCounts, type ComparisonMetric, type ComparisonValues } from "@/lib/comparison-analysis";

const label = (status: string | null) => status ?? "Unmatched";
export function CompareCharts({ rows, onTransition, onCase }: { rows: ComparisonValues[]; onTransition: (key: string) => void; onCase: (key: string) => void }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [metric, setMetric] = useState<ComparisonMetric>("cost");
  const cells = transitionCounts(rows);
  const selected = cells.find((cell) => cell.id === pinned);
  const states = [...new Set(rows.flatMap((row) => [row.aStatus, row.bStatus]))].sort((a, b) => label(a).localeCompare(label(b)));
  const max = Math.max(1, ...cells.map((cell) => cell.count));
  useEffect(() => { setPinned(null); }, [rows]);
  useEffect(() => {
    const restore = () => { const value = new URLSearchParams(window.location.search).get("cmpMetric"); setMetric(value === "rate" || value === "turns" ? value : "cost"); };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const setMetricFilter = (next: ComparisonMetric) => { setMetric(next); const url = new URL(window.location.href); url.searchParams.set("cmpMetric", next); window.history.pushState(null, "", url); };
  const deltas = rows.flatMap((row) => { const value = comparisonDelta(row, metric); return value === null ? [] : [{ id: comparisonKey(row), label: `${row.caseName} · sample ${row.sample + 1}`, value, detail: `${label(row.aStatus)} → ${label(row.bStatus)}${metric === "cost" ? ` · ${row.aCostSource ?? "unspecified"} → ${row.bCostSource ?? "unspecified"} cost` : ""}`, tone: (value === 0 ? "accent" : (metric === "rate" ? value > 0 : value < 0) ? "ok" : "err") as "accent" | "ok" | "err" }]; }).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const format = (value: number) => `${metric === "cost" ? "$" : ""}${Number(value.toFixed(metric === "cost" ? 6 : metric === "rate" ? 2 : 0))}`;
  return <div className="grid gap-3 mb-4 lg:grid-cols-2">
    <ChartFrame title="Outcome transitions" description="All case/sample pairs in this run comparison. Unmatched means the sample is absent on that side; it is not a failure." unit="Rows: baseline A · columns: comparison B · cells: case/sample count"
      table={{ headers: ["Baseline A", "Comparison B", "Case/sample pairs"], rows: cells.map((cell) => ({ id: cell.id, cells: [label(cell.from), label(cell.to), cell.count] })) }}>
      <div className="analysis-table" role="region" tabIndex={0} aria-label="Outcome transition matrix" onKeyDown={(event) => { if (event.key === "Escape") setPinned(null); }}>
        <table className="w-full text-xs text-center"><thead><tr><th scope="col">A ↓ / B →</th>{states.map((state) => <th key={label(state)} scope="col">{label(state)}</th>)}</tr></thead><tbody>{states.map((from) => <tr key={label(from)}><th scope="row">{label(from)}</th>{states.map((to) => {
          const cell = cells.find((candidate) => candidate.from === from && candidate.to === to);
          return <td key={label(to)}>{cell ? <button type="button" className="analysis-control min-w-11" aria-label={`${label(from)} to ${label(to)}: ${cell.count} case/sample pairs`} aria-pressed={pinned === cell.id} onClick={() => setPinned(pinned === cell.id ? null : cell.id)} style={{ background: `color-mix(in srgb, var(--color-accent) ${10 + cell.count / max * 35}%, var(--color-bg))` }}>{cell.count}</button> : <span className="text-fg-dim">0</span>}</td>;
        })}</tr>)}</tbody></table>
      </div>
      {selected && <div className="flex flex-wrap gap-2 items-center mt-3 text-xs" aria-live="polite"><span>{label(selected.from)} → {label(selected.to)} · {selected.count} pairs</span><button type="button" className="analysis-control" onClick={() => onTransition(selected.id)}>Explore these cases</button><button type="button" className="analysis-control" onClick={() => setPinned(null)}>Clear inspection</button></div>}
    </ChartFrame>
    <ChartFrame title="Per-case metric changes" description="Compare A and B on a shared scale for the same case and sample. The table retains B minus A; missing values have no plotted mark." unit="Each available side is plotted; missing values have no mark and remain unavailable in the delta table."

      table={{ headers: ["Case/sample", "Cost Δ (USD)", "Output rate Δ", "Turns Δ", "Cost evidence A → B"], rows: rows.map((row) => ({ id: comparisonKey(row), cells: [`${row.caseName} · sample ${row.sample + 1}`, ...(["cost", "rate", "turns"] as const).map((key) => comparisonDelta(row, key) ?? "Unavailable"), `${row.aCostSource ?? "unspecified"} → ${row.bCostSource ?? "unspecified"}`] })) }}>
      <><label className="text-xs text-fg-muted">Metric <select className="analysis-input mb-3" value={metric} onChange={(event) => setMetricFilter(event.target.value as ComparisonMetric)}><option value="cost">Cost (USD)</option><option value="rate">Output tokens / second</option><option value="turns">Turns</option></select></label><p className="text-xs text-fg-muted mb-2">{deltas.length} / {rows.length} pairs have both values; {rows.length - deltas.length} unavailable.</p><PairedValues rows={rows.map(row => ({ id: comparisonKey(row), label: `${row.caseName} · sample ${row.sample + 1}`, a: metric === "cost" ? row.aCost : metric === "rate" ? row.aTokPerSec : row.aTurns, b: metric === "cost" ? row.bCost : metric === "rate" ? row.bTokPerSec : row.bTurns, detail: `${label(row.aStatus)} → ${label(row.bStatus)} · ${metric === "cost" ? `${row.aCostSource ?? "unspecified"} → ${row.bCostSource ?? "unspecified"} cost evidence` : "paired case/sample values"}` }))} format={format} onExplore={onCase} /></>
    </ChartFrame>
  </div>;
}
