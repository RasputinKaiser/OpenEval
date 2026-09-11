"use client";

/**
 * CostVsOutcome — scatter of session cost (USD, log x) against deterministic outcome
 * score (0..1, y). Answers the question no other chart here answers: does spend buy
 * success? Points are colored by outcome provenance (judged vs heuristic) so the
 * researcher can see which cloud is model-reviewed. Hover = tooltip; keyboard =
 * focusable dots with value readout. No identifiers are rendered (PII rule).
 */

import { useMemo } from "react";
import { fmtUsd } from "@/lib/format";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";

export interface ScatterPoint {
  c: number; // cost USD
  o: number; // outcome 0..1
  p: "judged" | "heuristic" | string; // OutcomeProvenance — judged/heuristic/unavailable
}

const W = 560;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

// Log decade gridlines: $0.01 → $100 covers hobbyist to tokenmaxxer sessions.
const DECADES = [0.01, 0.1, 1, 10, 100];
const LOG_MIN = Math.log10(0.01);
const LOG_MAX = Math.log10(100);

function xOf(cost: number): number {
  const v = Math.min(LOG_MAX, Math.max(LOG_MIN, Math.log10(Math.max(cost, 0.01))));
  return PAD.left + ((v - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (W - PAD.left - PAD.right);
}

function yOf(outcome: number): number {
  return H - PAD.bottom - outcome * (H - PAD.top - PAD.bottom);
}

export function CostVsOutcome({ points, evidence }: { points: ScatterPoint[]; evidence: { n: number; denominator: number; coverage: number } }) {
  const { tip, show, showAt, hide, togglePin } = useChartTooltip();

  const stats = useMemo(() => {
    if (points.length < 2) return null;
    const sorted = [...points].sort((a, b) => a.c - b.c);
    const judged = points.filter((p) => p.p === "judged"); // provenance-tagged
    // Spearman-ish readout: median outcome of the cheapest half vs dearest half.
    const half = Math.floor(sorted.length / 2);
    const med = (arr: { o: number }[]) => {
      const s = arr.map((p) => p.o).sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    return {
      cheap: med(sorted.slice(0, half)),
      dear: med(sorted.slice(half)),
      split: half,
      judgedN: judged.length,
    };
  }, [points]);

  if (points.length < 3) {
    return (
      <div className="rounded-md border border-bd-subtle bg-bg-subtle/40 p-4 text-xs text-fg-muted">
        Not enough sessions with both a cost and an outcome signal to plot (have {evidence.n}). Run more sessions or review more with the judge.
      </div>
    );
  }

  const readout = stats
    ? `Median outcome: ${stats.cheap.toFixed(2)} below $${sortedMidpoint(points, stats.split)}, ${stats.dear.toFixed(2)} above.`
    : "";

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Scatter of ${points.length} sessions: cost on a log scale against outcome score. ${readout}`}>
          {/* decade gridlines */}
          {DECADES.map((d) => (
            <g key={d}>
              <line x1={xOf(d)} y1={PAD.top} x2={xOf(d)} y2={H - PAD.bottom} stroke="var(--color-bd-subtle)" strokeWidth="1" />
              <text x={xOf(d)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--color-fg-dim)" className="mono">{fmtUsd(d)}</text>
            </g>
          ))}
          {/* y guides at 0 / 0.5 / 1 */}
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={PAD.left} y1={yOf(v)} x2={W - PAD.right} y2={yOf(v)} stroke="var(--color-bd-subtle)" strokeWidth="1" strokeDasharray={v === 0.5 ? "3 3" : undefined} />
              <text x={PAD.left - 5} y={yOf(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-fg-dim)" className="mono">{v}</text>
            </g>
          ))}
          {/* dots: judged on top so model-reviewed cloud is visible */}
          {[...points].sort((a) => (a.p === "judged" ? 1 : -1)).map((pt, i) => {
            const judged = pt.p === "judged";
            return (
              <circle
                key={i}
                cx={xOf(pt.c)}
                cy={yOf(pt.o)}
                r={judged ? 3.2 : 2.4}
                fill={judged ? "var(--color-accent)" : "color-mix(in srgb, var(--color-fg-muted) 55%, transparent)"}
                fillOpacity={judged ? 0.85 : 0.5}
                stroke={judged ? "var(--color-bg)" : "none"}
                strokeWidth="0.8"
                className="transition-[fill-opacity] duration-150 hover:fill-opacity-100"
                tabIndex={0}
                aria-label={`Session costing ${fmtUsd(pt.c)}, outcome ${pt.o.toFixed(2)}, ${pt.p}`}
                onMouseEnter={(e) => show(e, `${fmtUsd(pt.c)} · outcome ${pt.o.toFixed(2)} · ${pt.p}`)}
                onMouseLeave={hide}
                onFocus={(e) => showAt(e.currentTarget, `${fmtUsd(pt.c)} · outcome ${pt.o.toFixed(2)} · ${pt.p}`)}
                onBlur={hide}
                onClick={(e) => togglePin(e, `${fmtUsd(pt.c)} · outcome ${pt.o.toFixed(2)} · ${pt.p}`, `dot-${i}`)}
              />
            );
          })}
        </svg>
        {tip ? <ChartTooltip tip={tip} /> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-fg-dim">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-full" style={{ background: "var(--color-accent)" }} /> judge-reviewed{stats ? ` (${stats.judgedN})` : ""}</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-full" style={{ background: "color-mix(in srgb, var(--color-fg-muted) 55%, transparent)" }} /> heuristic signal</span>
        <span>n = {evidence.n} of {evidence.denominator} sessions ({Math.round(evidence.coverage * 100)}%)</span>
      </div>
    </div>
  );
}

function sortedMidpoint(points: ScatterPoint[], half: number): string {
  const sorted = [...points].sort((a, b) => a.c - b.c);
  return fmtUsd(sorted[Math.min(half, sorted.length - 1)]?.c ?? 0);
}
