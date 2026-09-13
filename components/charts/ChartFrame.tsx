"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import type { ChartEvidence } from "@/lib/chart-analysis";

export interface ChartTableRow { id: string; cells: ReactNode[]; }
export interface ChartTable { headers: string[]; rows: ChartTableRow[]; caption?: string; }

export function ChartFrame({ title, description, unit, evidence, actions, children, details, table, className = "" }: {
  title: string; description?: string; unit?: string; evidence?: ChartEvidence; actions?: ReactNode;
  children: ReactNode; details?: ReactNode; table?: ChartTable; className?: string;
}) {
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return <section aria-labelledby={`${id}-title`} className={`analysis-chart ${className}`}>
    <div className="analysis-chart__header">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm leading-5 text-fg-muted max-w-prose">{description}</p>}
        {unit && <p className="mt-1 text-xs text-fg-dim">{unit}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {table && <button type="button" className="analysis-control" aria-expanded={showTable} aria-controls={`${id}-table`} onClick={() => setShowTable(!showTable)}><Table2 size={14} aria-hidden />{showTable ? "Chart" : "Data table"}</button>}
        {details && <button type="button" className="analysis-control" aria-expanded={expanded} aria-controls={`${id}-details`} onClick={() => setExpanded(!expanded)}>Methodology <ChevronDown size={14} className={expanded ? "rotate-180" : ""} aria-hidden /></button>}
      </div>
    </div>
    {evidence && <div className="analysis-chart__evidence">
      <span>{evidence.scope}</span>
      <span className="tabular-nums">{evidence.eligible ?? evidence.population} eligible / {evidence.population}{evidence.plotted !== undefined ? ` · ${evidence.plotted} plotted` : ""}</span>
      {evidence.provenance && <span>{evidence.provenance}</span>}
      {evidence.partial && <span className="text-warn">Partial coverage</span>}
      {evidence.generatedAtMs != null && Number.isFinite(evidence.generatedAtMs) && Math.abs(evidence.generatedAtMs) <= 8.64e15 && <span>{evidence.stale ? "Last known" : "Snapshot"}: {new Date(evidence.generatedAtMs).toISOString().replace("T", " ").slice(0, 19)} UTC</span>}
    </div>}
    <div hidden={showTable} className="min-w-0">{children}</div>
    {table && showTable && <div id={`${id}-table`} className="analysis-table analysis-reveal" role="region" tabIndex={0} aria-label={`${title} data`}>
      <table className="w-full text-xs text-left"><caption className="sr-only">{table.caption ?? title}</caption>
        <thead><tr>{table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{table.rows.map((row) => <tr key={row.id}>{row.cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody>
      </table>
      {!table.rows.length && <p className="p-3 text-fg-muted">No matching evidence.</p>}
    </div>}
    {details && expanded && <div id={`${id}-details`} className="analysis-reveal mt-4 border-t border-bd-subtle pt-4">{details}</div>}
  </section>;
}

/** SVG view boxes match measured CSS pixels so labels do not shrink on phones. */
export function useChartSize(initialWidth = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  return { ref, width, compact: width < 480 };
}
