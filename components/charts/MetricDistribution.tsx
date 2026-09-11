"use client";

import { useState } from "react";
import { numericBins, numericSummary } from "@/lib/ui-analysis";
import { ChartFrame } from "./ChartFrame";

export function MetricDistribution({ title, values, format = String, unit, description }: {
  title: string; values: readonly (number | null | undefined)[]; format?: (value: number) => string; unit: string; description: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const bins = numericBins(values), summary = numericSummary(values);
  const selectedBin = bins.find(bin => `${bin.min}:${bin.max}` === selected);
  const maximum = Math.max(1, ...bins.map(bin => bin.count));
  const display = (value: number | null) => value === null ? "Unavailable" : format(value);
  return <ChartFrame title={title} description={description} unit={unit}
    table={{ headers: ["From (inclusive)", "To", "Count"], rows: bins.map((bin, i) => ({ id: String(i), cells: [format(bin.min), `${format(bin.max)}${bin.final ? " inclusive" : " exclusive"}`, bin.count] })) }}>
    <dl className="analysis-summary mb-3">{[["Available", summary.count], ["Missing", summary.missing], ["Median", display(summary.median)], ["90th percentile", display(summary.p90)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>)}</dl>
    {bins.length ? <div>
      <div className="flex items-end gap-1 h-32" role="group" aria-label={`${title} bins`} onKeyDown={event => { if (event.key === "Escape") setSelected(null); }}>
        {bins.map((bin, i) => <button key={i} type="button" className="flex-1 min-w-0 h-full flex flex-col justify-end rounded-t focus-visible:outline-offset-2" style={{ transform: "none" }} aria-pressed={selected === `${bin.min}:${bin.max}`} aria-label={`${format(bin.min)} to ${format(bin.max)}: ${bin.count}`} onClick={() => setSelected(selected === `${bin.min}:${bin.max}` ? null : `${bin.min}:${bin.max}`)}>
          <span className="block text-[10px] mono pb-1">{bin.count}</span><span className="block w-full rounded-t" style={{ height: `${Math.max(2, bin.count / maximum * 90)}px`, background: selected === `${bin.min}:${bin.max}` ? "var(--color-accent-soft)" : "var(--color-accent)", opacity: bin.count ? 1 : .2 }} />
        </button>)}
      </div>
      <div className="flex justify-between mt-2 text-[11px] mono text-fg-muted"><span>{display(summary.min)}</span><span>{display(summary.max)}</span></div>
      <p aria-live="polite" className="text-xs text-fg-muted mt-2 min-h-5">{selectedBin ? `${format(selectedBin.min)}–${format(selectedBin.max)}: ${selectedBin.count} observations` : "Select a bin to inspect its count."}</p>
    </div> : <p className="text-xs text-fg-muted">No available measurements in this selection.</p>}
  </ChartFrame>;
}
