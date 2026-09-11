"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { fmt, fmtUsd } from "./live-shared";

/**
 * Session footprint: every parsed session as one dot on a log cost axis,
 * vertically jittered within quality bands so dense regions stay readable.
 * Interactive: hover/focus a dot for that session's cost + duration; the
 * header stat swaps to the focused session (same contract as the day strips).
 *
 * Honest failure modes: sessions with no cost evidence (costUsd 0 AND inferred
 * rate missing) sit in a separate "no pricing evidence" rail at the top rather
 * than pretending to be free; non-finite values are excluded and counted.
 */
export function SessionFootprint({
  sessions,
  total,
  height = 96,
}: {
  sessions: Array<{ sessionId: string; costUsd: number; durationMs: number; dataQuality: number; isError: boolean }>;
  /** Full audited population (may exceed the windowed `sessions` slice). */
  total?: number;
  height?: number;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const plot = useMemo(() => {
    const usable = sessions.filter(
      (s) => Number.isFinite(s.costUsd) && Number.isFinite(s.durationMs) && s.durationMs >= 0,
    );
    const priced = usable.filter((s) => s.costUsd > 0);
    const unpriced = usable.filter((s) => s.costUsd <= 0);
    if (priced.length === 0) return null;
    const min = Math.min(...priced.map((s) => s.costUsd));
    const max = Math.max(...priced.map((s) => s.costUsd));
    const logMin = Math.log10(Math.max(min, 1e-5));
    const logMax = Math.log10(Math.max(max, min * 10, 1e-4));
    const span = Math.max(logMax - logMin, 0.5);
    // Density-aware placement: bin dots along x, then stack them within each bin
    // (beeswarm-ish) so cluster DENSITY is readable instead of hash noise. Hash only
    // breaks ties inside a bin, keeping placement stable across renders.
    const sorted = [...priced].map((s) => {
      const frac = (Math.log10(Math.max(s.costUsd, 1e-5)) - logMin) / span;
      let hash = 0;
      for (let i = 0; i < s.sessionId.length; i++) hash = (hash * 31 + s.sessionId.charCodeAt(i)) | 0;
      return { ...s, frac, hash: (hash >>> 0) % 1000 };
    }).sort((a, b) => a.frac - b.frac || a.hash - b.hash);
    const BINS = 40;
    const binCount = new Array(BINS).fill(0);
    const dots = sorted.map((s) => {
      const bin = Math.min(BINS - 1, Math.floor(s.frac * BINS));
      const k = binCount[bin]++;
      // Alternate above/below the centerline; spread grows with occupancy.
      const lane = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2);
      const step = 7;
      const y = height / 2 + lane * step;
      const clampedY = Math.min(height - 8, Math.max(8, y));
      return { ...s, x: Math.min(99, Math.max(1, s.frac * 96 + 2)), y: clampedY, unpriced: false };
    });
    const costs = priced.map((s) => s.costUsd).sort((a, b) => a - b);
    const median = costs.length % 2 ? costs[(costs.length - 1) / 2] : (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2;
    const medianX = (Math.log10(Math.max(median, 1e-5)) - logMin) / span * 96 + 2;
    // Decade gridlines within range.
    const ticks: Array<{ x: number; label: string }> = [];
    for (let e = Math.ceil(logMin); e <= Math.floor(logMax); e++) {
      const v = Math.pow(10, e);
      if (v >= min * 0.99 && v <= max * 1.01) {
        ticks.push({ x: (Math.log10(v) - logMin) / span * 96 + 2, label: fmtUsd(v) });
      }
    }
    return { dots, unpricedCount: unpriced.length, max, median, medianX, ticks };
  }, [sessions, height]);

  if (!plot) {
    return (
      <div className="rounded-md border border-dashed border-bd-subtle bg-bg-elev px-3 py-3 text-xs text-fg-muted" role="status">
        No priced sessions in the scanned slice — cost evidence comes from listed rates applied to measured usage.
      </div>
    );
  }

  const active = plot.dots.find((d) => d.sessionId === activeId) ?? null;
  const headerStat = active
    ? `${fmtUsd(active.costUsd)} · ${fmt(active.durationMs)}`
    : `${plot.dots.length} priced sessions`;

  return (
    <div onMouseLeave={() => setActiveId(null)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Session cost footprint <span className="normal-case tracking-normal text-fg-dim">· n = {plot.dots.length} of {total ?? sessions.length} sessions</span></span>
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-colors duration-150",
            active ? "bg-accent/15 text-accent-soft" : "text-fg-dim",
          )}
          aria-live="polite"
        >
          {headerStat}
        </span>
      </div>
      <div
        className="relative rounded-md bg-bg-elev/50"
        style={{ height }}
        role="img"
        aria-label={`Cost distribution of ${plot.dots.length} sessions on a logarithmic axis from ${fmtUsd(plot.dots.reduce((m, d) => Math.min(m, d.costUsd), Infinity))} to ${fmtUsd(plot.max)}${plot.unpricedCount ? `; ${plot.unpricedCount} sessions without cost evidence are not plotted` : ""}`}
>
        {/* Log-axis gridlines at real decade ticks, with a median reference line. */}
        {plot.ticks.map((t) => (
          <div key={t.x} aria-hidden className="absolute inset-y-2 w-px bg-bd-subtle" style={{ left: `${t.x}%` }} />
        ))}
        <div
          aria-hidden
          className="absolute inset-y-2 w-px bg-ok/50"
          style={{ left: `${plot.medianX}%` }}
          title={`Median session cost ${fmtUsd(plot.median)}`}
        />
        <div
          aria-hidden
          className="absolute -top-0.5 rounded bg-bg-elev px-1 text-[8px] tabular-nums text-ok"
          style={{
            left: `${plot.medianX}%`,
            transform: plot.medianX > 85 ? "translateX(-100%)" : plot.medianX < 15 ? "translateX(0)" : "translateX(-50%)",
          }}
        >
          median {fmtUsd(plot.median)}
        </div>
        {plot.dots.map((d) => (
          <button
            key={d.sessionId}
            type="button"
            tabIndex={0}
            aria-label={`Session ${d.sessionId.slice(-6)} — ${fmtUsd(d.costUsd)}, ${fmt(d.durationMs)}`}
            onMouseEnter={() => setActiveId(d.sessionId)}
            onFocus={() => setActiveId(d.sessionId)}
            onBlur={() => setActiveId(null)}
            className={clsx(
              "group/dot absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-default items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
            style={{ left: `${d.x}%`, top: `${d.y}px` }}
          >
            <span
              aria-hidden
              className={clsx(
                "block size-2.5 rounded-full ring-1 ring-bg/60 mix-blend-screen transition-[transform,background-color,box-shadow] duration-150 dark:mix-blend-screen",
                d.isError ? "bg-err/70" : "bg-accent/70",
                activeId === d.sessionId && "scale-125 bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]",
              )}
            />
          </button>
        ))}
      </div>
      {/* Decade tick labels under the plot, aligned to the same x positions. */}
      {plot.ticks.length > 0 && (
        <div aria-hidden className="relative mt-0.5 h-3">
          {plot.ticks.map((t) => (
            <span key={t.x} className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] tabular-nums text-fg-dim" style={{ left: `${t.x}%` }}>{t.label}</span>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between text-[9px] text-fg-dim">
        <span className="mono">{fmtUsd(Math.max(1e-5, plot.dots.reduce((m, d) => Math.min(m, d.costUsd), Infinity)))}</span>
        <span>session cost (USD, log scale)</span>
        <span className="mono">{fmtUsd(plot.max)}</span>
      </div>
    </div>
  );
}
