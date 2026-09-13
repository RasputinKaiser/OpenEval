"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fmtUsd } from "@/lib/format";
import { logDomain } from "@/lib/chart-analysis";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { ChartFrame, useChartSize } from "./charts/ChartFrame";

export interface ScatterPoint {
  c: number;
  o: number;
  p: "judged" | "heuristic" | string;
  sourceId?: string;
  sessionId?: string;
  costSource?: string;
  at?: number;
}
interface ScatterEvidence {
  n: number; denominator: number; coverage: number;
  plotted?: number; omittedZero?: number; omittedMissing?: number;
  summary?: { cheaper: { n: number; medianCostUsd: number | null; medianOutcome: number | null; provenance: string }; dearer: { n: number; medianCostUsd: number | null; medianOutcome: number | null; provenance: string } };
}
const exactCost = (cost: number) => cost === 0 ? "$0" : cost < 0.001 || cost >= 1e6 ? `$${String(cost)}` : `$${cost.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
function reference(point: ScatterPoint): string | null {
  if (!point.sourceId || !point.sessionId) return null;
  return `/collection/session?${new URLSearchParams({ sourceId: point.sourceId, sessionId: point.sessionId })}`;
}

export function CostVsOutcome({ points, evidence }: { points: ScatterPoint[]; evidence: ScatterEvidence }) {
  const { ref, width, compact } = useChartSize(560);
  const { tip, show, showAt, hide, togglePin, unpin } = useChartTooltip();
  const unpinRef = useRef(unpin);
  unpinRef.current = unpin;
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [provenance, setProvenance] = useState("all");
  const [costSource, setCostSource] = useState("all");
  const [inspectLimit, setInspectLimit] = useState(12);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const outcome = params.get("scatterOutcome"), cost = params.get("scatterCost");
      setProvenance(outcome === "judged" || outcome === "heuristic" ? outcome : "all");
      setCostSource(cost === "measured" || cost === "inferred" ? cost : "all");
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const inspectFilter = (key: "scatterOutcome" | "scatterCost", value: string) => {
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete(key); else url.searchParams.set(key, value);
    window.history.pushState(null, "", url);
    if (key === "scatterOutcome") setProvenance(value); else setCostSource(value);
  };
  const height = compact ? 240 : 280;
  const pad = { left: 36, right: 18, top: 18, bottom: 36 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const readable = useMemo(() => points.filter((p) => Number.isFinite(p.c) && p.c > 0 && Number.isFinite(p.o) && p.o >= 0 && p.o <= 1), [points]);
  const domain = useMemo(() => logDomain(readable.map((p) => p.c)), [readable]);
  const filtered = useMemo(() => readable.filter((p) => (provenance === "all" || p.p === provenance) && (costSource === "all" || p.costSource === costSource)), [readable, provenance, costSource]);
  const groups = useMemo(() => {
    if (!domain) return [];
    const cells = new Map<string, { id: string; x: number; y: number; points: ScatterPoint[] }>();
    for (const point of filtered) {
      const x = pad.left + ((Math.log10(point.c) - domain.min) / (domain.max - domain.min)) * plotWidth;
      const y = height - pad.bottom - point.o * (height - pad.top - pad.bottom);
      // Nearby marks share a hit target, while every exact value remains in the list.
      const id = `${Math.round(x / 9)}:${Math.round(y / 9)}`;
      const cell = cells.get(id);
      if (cell) cell.points.push(point);
      else cells.set(id, { id, x, y, points: [point] });
    }
    return [...cells.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  }, [filtered, domain, plotWidth, height, pad.left, pad.bottom, pad.top]);
  const selected = groups.find((g) => g.id === pinned);
  useEffect(() => { setPinned(null); setActive(0); setInspectLimit(12); unpinRef.current(); /* dataset/geometry changes invalidate pinned coordinates */
  }, [points, width, provenance, costSource]);
  const describe = (group: typeof groups[number]) => {
    const costs = group.points.map((p) => p.c);
    const outcomes = group.points.map((p) => p.o);
    return `${group.points.length} plotted session${group.points.length === 1 ? "" : "s"} · ${exactCost(Math.min(...costs))}${costs.length > 1 ? `–${exactCost(Math.max(...costs))}` : ""} · outcome ${Math.min(...outcomes).toFixed(2)}${outcomes.length > 1 ? `–${Math.max(...outcomes).toFixed(2)}` : ""}`;
  };
  const tableRows = filtered.map((p, i) => ({ id: `${p.sourceId ?? ""}:${p.sessionId ?? i}:${i}`, cells: [exactCost(p.c), String(p.o), p.p, p.costSource ?? "unspecified", reference(p) ? <Link className="text-accent-soft underline" href={reference(p)!}>Open session evidence</Link> : "Reference unavailable"] }));
  const context = `${filtered.length} visible of ${readable.length} plotted; ${evidence.n} eligible / ${evidence.denominator} top-level sessions (${Math.round(evidence.coverage * 100)}% coverage).`;
  return <ChartFrame title="Cost vs. outcome" description="Inspect the relationship between session cost and outcome. This is descriptive evidence, not a causal effect." unit="Horizontal: positive cost, USD (log scale). Vertical: outcome score, 0–1."
    table={{ headers: ["Cost (USD)", "Outcome", "Outcome evidence", "Cost evidence", "Session"], rows: tableRows }}
    actions={<><label className="text-xs text-fg-muted">Outcome<select aria-label="Scatter outcome evidence" className="analysis-input ml-2" value={provenance} onChange={(e) => inspectFilter("scatterOutcome", e.target.value)}><option value="all">All plotted</option><option value="judged">Judged</option><option value="heuristic">Heuristic</option></select></label><label className="text-xs text-fg-muted">Cost<select aria-label="Scatter cost evidence" className="analysis-input ml-2" value={costSource} onChange={(e) => inspectFilter("scatterCost", e.target.value)}><option value="all">All plotted</option><option value="measured">Measured</option><option value="inferred">Inferred</option></select></label></>}>
    <p className="text-xs text-fg-muted mb-3">{context} {evidence.n > readable.length ? "Points sample the entire selected period; they are not the full population." : ""} Filters here inspect the plotted sample.</p>
    <div ref={ref} className="relative min-w-0">
      {!domain || !groups.length ? <p role="status" className="py-6 text-sm text-fg-muted">{readable.length ? "No plotted sessions match these evidence filters." : "No positive costs with usable outcome evidence to plot."}</p> : <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" role="group" tabIndex={0}
        aria-label={`Cost and outcome scatter. ${context} Use left and right arrows to inspect groups, Enter to pin, Escape to clear.`}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setPinned(null); unpin(); return; }
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            const next = e.key === "Home" ? 0 : e.key === "End" ? groups.length - 1 : Math.max(0, Math.min(groups.length - 1, active + (e.key === "ArrowRight" ? 1 : -1)));
            setActive(next); showAt(e.currentTarget, describe(groups[next]));
          } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPinned(groups[Math.min(active, groups.length - 1)].id); setInspectLimit(12); }
        }}>
        {domain.ticks.filter((_, i) => !compact || i % 2 === 0).map((tick) => {
          const x = pad.left + ((Math.log10(tick) - domain.min) / (domain.max - domain.min)) * plotWidth;
          return <g key={tick} aria-hidden><line x1={x} x2={x} y1={pad.top} y2={height - pad.bottom} stroke="var(--color-bd-subtle)" /><text x={x} y={height - 12} textAnchor="middle" fontSize="11" fill="var(--color-fg-muted)">{tick < 0.001 ? tick.toExponential(0) : fmtUsd(tick)}</text></g>;
        })}
        {[0, .5, 1].map((value) => { const y = height - pad.bottom - value * (height - pad.top - pad.bottom); return <g key={value} aria-hidden><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--color-bd-subtle)" /><text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-fg-muted)">{value}</text></g>; })}
        {groups.map((group, i) => {
          const judged = group.points.some((point) => point.p === "judged");
          return <g key={group.id} onMouseMove={(e) => { setActive(i); show(e, describe(group)); }} onMouseLeave={hide} onClick={(e) => { e.stopPropagation(); setActive(i); setPinned(pinned === group.id ? null : group.id); setInspectLimit(12); togglePin(e, describe(group), group.id); }} className="cursor-pointer">
            <circle cx={group.x} cy={group.y} r={12} fill="transparent" />
            <circle cx={group.x} cy={group.y} r={Math.min(9, 3 + Math.sqrt(group.points.length))} fill={judged ? "var(--color-accent)" : "var(--color-fg-muted)"} fillOpacity={judged ? .85 : .5} stroke={pinned === group.id || active === i ? "var(--color-fg)" : "var(--color-bg-subtle)"} strokeWidth={pinned === group.id ? 2 : 1} pointerEvents="none" />
          </g>;
        })}
      </svg>}
      {tip && <ChartTooltip tip={tip} />}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted"><span>Violet: includes judged · neutral: heuristic</span><span>Mark size: overlapping plotted sessions</span><span>{evidence.omittedZero === undefined ? "Zero costs are omitted from the log scale" : `${evidence.omittedZero} zero-cost sessions omitted from log scale`}</span>{evidence.omittedMissing !== undefined && <span>{evidence.omittedMissing} missing cost/outcome values omitted</span>}</div>
    {evidence.summary && <details className="mt-3 text-xs text-fg-muted"><summary className="cursor-pointer py-2">Compare cost halves across all eligible sessions</summary><p className="mt-2">Split at the population median cost; descriptive aggregates may mix workloads and outcome evidence.</p><div className="analysis-table mt-2" role="region" tabIndex={0} aria-label="Full population cost comparison"><table className="w-full text-left"><thead><tr><th>Cost half</th><th>Sessions</th><th>Median USD</th><th>Median outcome</th><th>Outcome evidence</th></tr></thead><tbody>{(["cheaper", "dearer"] as const).map((key) => { const half = evidence.summary![key]; return <tr key={key}><td>{key}</td><td>{half.n}</td><td>{half.medianCostUsd !== null ? exactCost(half.medianCostUsd) : "Unavailable"}</td><td>{half.medianOutcome !== null ? String(half.medianOutcome) : "Unavailable"}</td><td>{half.provenance}</td></tr>; })}</tbody></table></div></details>}
    {selected && <div className="mt-4 border-t border-bd-subtle pt-3" aria-live="polite">
      <div className="flex flex-wrap gap-3 items-center mb-2"><p className="text-sm">{describe(selected)}</p><button type="button" className="analysis-control" onClick={() => { setPinned(null); unpin(); }}>Clear inspection</button></div>
      <ul className="space-y-2">{selected.points.slice(0, inspectLimit).map((p, i) => <li key={`${p.sourceId}:${p.sessionId}:${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className="mono">{exactCost(p.c)} · {String(p.o)}</span><span className="text-fg-muted">{p.p} outcome · {p.costSource ?? "unspecified"} cost</span>{reference(p) ? <Link className="analysis-control text-accent-soft" href={reference(p)!}>Explore session evidence</Link> : <span className="text-fg-muted">Session reference unavailable</span>}</li>)}</ul>
      {selected.points.length > inspectLimit && <button type="button" className="analysis-control mt-3" onClick={() => setInspectLimit(inspectLimit + 20)}>Show more plotted sessions ({selected.points.length - inspectLimit} remaining)</button>}
    </div>}
  </ChartFrame>;
}
