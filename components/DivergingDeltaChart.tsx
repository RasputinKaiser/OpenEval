"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { fmtSigned } from "@/lib/format";

/**
 * Diverging outcome-delta chart for adoption comparisons: one horizontal bar
 * per adoption, extending right (green) when the outcome median improved in
 * the after-window and left (red) when it declined. Comparable rows only —
 * thin-evidence rows are excluded here (they stay visible in the table).
 * Bars share one scale (the largest |delta|), so lengths are comparable.
 */
export function DivergingDeltaChart({
  items,
  max = 12,
}: {
  items: Array<{ name: string; kind: string; delta: number | null; color: string }>;
  max?: number;
}) {
  const comparable = useMemo(
    () =>
      items
        .filter((it) => it.delta != null && Number.isFinite(it.delta))
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
        .slice(0, max),
    [items, max],
  );
  const scale = Math.max(0.05, ...comparable.map((it) => Math.abs(it.delta ?? 0)));

  if (comparable.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-bd-subtle bg-bg-elev px-3 py-3 text-xs text-fg-muted" role="status">
        No comparable outcome deltas in the current filter — thin-evidence rows stay in the table below.
      </div>
    );
  }

  return (
    <div className="space-y-1.5" role="img" aria-label={`Outcome delta per adoption, scaled to ±${scale.toFixed(2)}`}>
      {comparable.map((it) => {
        const d = it.delta ?? 0;
        const pct = (Math.abs(d) / scale) * 50; // half-width per side
        const positive = d >= 0;
        return (
          <div key={`${it.kind}-${it.name}`} className="group flex items-center gap-2 text-xs min-w-0">
            <span className="w-8 shrink-0 text-center" title={`adoption kind: ${it.kind}`}>
              <span className="inline-block size-2 rounded-full" style={{ background: it.color }} />
            </span>
            <span className="w-36 min-w-0 shrink-0 truncate text-fg-muted group-hover:text-fg transition-colors" title={it.name}>
              {it.name}
            </span>
            <div className="relative h-[10px] min-w-0 flex-1">
              {/* zero axis */}
              <span className="absolute inset-y-0 left-1/2 w-[2px] bg-bd" aria-hidden />
              <span
                className={clsx(
                  "absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[2px] transition-[width] duration-500",
                  positive ? "left-1/2 bg-ok/70" : "right-1/2 bg-err/70",
                )}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <span
              className={clsx(
                "w-12 shrink-0 text-right mono tabular-nums",
                positive ? "text-ok" : "text-err",
              )}
            >
              {fmtSigned(d)}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1 text-[9px] text-fg-dim">
        {comparable.some((it) => (it.delta ?? 0) < 0) ? <span>← declined</span> : <span>all improved →</span>}
        <span>0</span>
        <span>improved →</span>
      </div>
    </div>
  );
}
