"use client";
import { ChartTooltip, useChartTooltip } from "../ChartTooltip";
import { useState } from "react";
export interface PairedValue { id: string; label: string; a: number | null; b: number | null; detail?: string; }
/** A shared axis shows actual paired values. Marks never imply missing values are zero. */
export function PairedValues({ rows, format = String, onExplore }: { rows: PairedValue[]; format?: (value: number) => string; onExplore?: (id: string) => void }) {
  const { tip, show, showAt, hide, unpin } = useChartTooltip();
  const [pin, setPin] = useState<string | null>(null), [all, setAll] = useState(false);
  const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
  const values = rows.flatMap(row => [row.a, row.b].filter(finite));
  const min = Math.min(0, ...values), max = Math.max(0, ...values), span = max - min || 1, position = (value: number) => 4 + (value - min) / span * 92;
  const selected = rows.find(row => row.id === pin);
  const valueText = (value: number | null) => finite(value) ? format(value) : "Unavailable";
  return <div onKeyDown={event => { if (event.key === "Escape") { setPin(null); unpin(); } }}>
    <p className="text-xs text-fg-muted mb-2"><span className="text-accent-soft">● A</span> baseline · <span className="text-ok">◆ B</span> comparison · shared scale</p>
    {(all ? rows : rows.slice(0, 12)).map(row => <button key={row.id} type="button" className="analysis-pair" aria-pressed={pin === row.id} aria-label={`${row.label}: A ${valueText(row.a)}, B ${valueText(row.b)}`} onMouseMove={event => show(event, `${row.label}: A ${valueText(row.a)} → B ${valueText(row.b)}${row.detail ? ` · ${row.detail}` : ""}`)} onMouseLeave={hide} onFocus={event => showAt(event.currentTarget, `${row.label}: A ${valueText(row.a)} → B ${valueText(row.b)}`)} onBlur={hide} onClick={() => { hide(); setPin(pin === row.id ? null : row.id); }}>
      <span className="text-xs truncate">{row.label}</span>
      <svg viewBox="0 0 100 24" className="w-full h-7 overflow-visible" aria-hidden>
        <line x1="4" x2="96" y1="12" y2="12" stroke="var(--color-bd)" />
        {finite(row.a) && finite(row.b) && <line x1={position(row.a)} x2={position(row.b)} y1="12" y2="12" stroke="var(--color-fg-muted)" strokeWidth="2" />}
        {finite(row.a) && <circle cx={position(row.a)} cy="12" r="3" fill="var(--color-accent-soft)" />}
        {finite(row.b) && <path d={`M${position(row.b)} 8 l4 4 -4 4 -4 -4 Z`} fill="var(--color-ok)" />}
      </svg>
      <span className="mono text-xs">{valueText(row.a)} → {valueText(row.b)}</span>
    </button>)}
    {rows.length > 12 && <button type="button" className="analysis-control mt-2" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length} pairs`}</button>}
    {selected && <div className="analysis-reveal mt-3 text-xs border-t border-bd-subtle pt-3" aria-live="polite"><p>{selected.label} · A {valueText(selected.a)} → B {valueText(selected.b)}</p>{selected.detail && <p className="text-fg-muted mt-1">{selected.detail}</p>}{onExplore && <button type="button" className="analysis-control mt-2" onClick={() => onExplore(selected.id)}>Explore this pair</button>}<button type="button" className="analysis-control mt-2 ml-2" onClick={() => setPin(null)}>Clear inspection</button></div>}
    {tip && <ChartTooltip tip={tip} />}
  </div>;
}
