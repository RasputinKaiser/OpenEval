"use client";

import { useState } from "react";
import clsx from "clsx";

export type EvidenceTone = "measured" | "judged" | "inferred" | "heuristic" | "missing" | "none";

export interface EvidenceSegment {
  label: string;
  value: number;
  tone: EvidenceTone;
}

const NUMBER = new Intl.NumberFormat();

const SEGMENT_BACKGROUND: Record<EvidenceTone, string> = {
  measured: "var(--color-ok)",
  judged: "var(--color-accent)",
  inferred: "repeating-linear-gradient(135deg, var(--color-accent-soft) 0 4px, color-mix(in srgb, var(--color-accent) 28%, transparent) 4px 8px)",
  heuristic: "repeating-linear-gradient(135deg, var(--color-accent-soft) 0 3px, color-mix(in srgb, var(--color-accent) 18%, transparent) 3px 7px)",
  missing: "repeating-linear-gradient(90deg, var(--color-warn) 0 2px, color-mix(in srgb, var(--color-warn) 28%, transparent) 2px 5px)",
  none: "var(--color-bd)",
};

const LEGEND_TONE: Record<EvidenceTone, string> = {
  measured: "text-ok",
  judged: "text-accent-soft",
  inferred: "text-accent-soft",
  heuristic: "text-accent-soft",
  missing: "text-warn",
  none: "text-fg-dim",
};

function cleanSegments(segments: EvidenceSegment[]): EvidenceSegment[] {
  return segments.map((segment) => ({
    ...segment,
    value: Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0,
  }));
}

/**
 * Compact, denominator-explicit composition bar. Patterns keep provenance
 * classes distinguishable without relying on color alone.
 */
export function EvidenceComposition({
  label,
  total,
  segments,
  note,
  className,
}: {
  label: string;
  total: number;
  segments: EvidenceSegment[];
  note?: string;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const clean = cleanSegments(segments);
  const describedTotal = clean.reduce((sum, segment) => sum + segment.value, 0);
  const denominator = Math.max(safeTotal, describedTotal);
  const aria = `${label}: ${clean.map((segment) => `${NUMBER.format(segment.value)} ${segment.label}`).join(", ")}; ${NUMBER.format(denominator)} total`;

  return (
    <div className={clsx("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium text-fg">{label}</span>
        <span className="mono shrink-0 text-[10px] tabular-nums text-fg-dim">{NUMBER.format(denominator)} total</span>
      </div>
      {(() => {
        const visible = clean.filter((s) => s.value > 0);
        // Percent shares: rounded per segment, but the LAST visible segment absorbs the
        // rounding remainder so printed shares always sum to 100%.
        const share = (v: number, index: number) => {
          if (denominator <= 0 || visible.length === 0) return "0%";
          if (index === visible.length - 1) {
            const priorSum = visible.slice(0, -1).reduce((sum, s) => sum + s.value, 0);
            return `${Math.max(0, 100 - Math.round((priorSum / denominator) * 100))}%`;
          }
          return `${Math.round((v / denominator) * 100)}%`;
        };
        const dominant = visible.length === 1 && denominator > 0 && visible[0].value / denominator >= 0.995;
        return (
          <>
            <div
              className={clsx(
                "relative flex overflow-hidden rounded-full bg-bg-elev transition-[height] duration-150",
                dominant ? "h-5" : "h-2.5",
              )}
              role="img"
              aria-label={aria}
              onMouseLeave={() => setHovered(null)}
            >
              {denominator > 0 && clean.map((segment) => {
                const key = `${segment.label}-${segment.tone}`;
                const isDim = hovered !== null && hovered !== key;
                return segment.value > 0 ? (
                  <span
                    key={key}
                    aria-hidden="true"
                    onMouseEnter={() => setHovered(key)}
                    onFocus={() => setHovered(key)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    className="h-full cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    style={{
                      width: `${Math.max(2, (segment.value / denominator) * 100)}%`,
                      background: SEGMENT_BACKGROUND[segment.tone],
                      opacity: isDim ? 0.35 : 1,
                      transition: "opacity 150ms",
                    }}
                    data-striped={segment.tone === "inferred" || segment.tone === "heuristic" || segment.tone === "missing" ? "" : undefined}
                    title={`${segment.label}: ${NUMBER.format(segment.value)} (${share(segment.value, visible.indexOf(segment))})`}
                  />
                ) : null;
              })}
              {dominant && visible.length === 1 && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 grid place-items-center text-[10px] font-medium text-pretty"
                  style={{ color: visible[0].tone === "measured" || visible[0].tone === "judged" ? "#05270f" : undefined }}
                >
                  {visible[0].tone === "measured" ? `100% measured · ${NUMBER.format(denominator)} sessions`
                    : visible[0].tone === "judged" ? `100% judged · ${NUMBER.format(denominator)} sessions`
                    : `${visible[0].label} 100%`}
                </span>
              )}
            </div>
            <div className={clsx("flex flex-wrap gap-x-3 gap-y-1", dominant ? "mt-1" : "mt-1.5")} onMouseLeave={() => setHovered(null)}>
              {clean.map((segment) => {
                const key = `${segment.label}-${segment.tone}`;
                const isDim = hovered !== null && hovered !== key;
                return (
                  <span
                    key={key}
                    onMouseEnter={() => setHovered(key)}
                    className={clsx(
                      "inline-flex cursor-default items-center gap-1 text-[10px] transition-opacity duration-150",
                      LEGEND_TONE[segment.tone],
                    )}
                    style={{ opacity: isDim ? 0.4 : 1 }}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-[2px] ring-1 ring-current/20"
                      style={{ background: SEGMENT_BACKGROUND[segment.tone] }}
                    />
                    <span className={clsx("text-fg-muted", hovered === key && "text-fg")}>{segment.label}</span>
                    <span className="mono tabular-nums">{NUMBER.format(segment.value)}<span className="text-fg-dim"> · {share(segment.value, visible.indexOf(segment))}</span></span>
                  </span>
                );
              })}
            </div>
          </>
        );
      })()}
      {note && <p className="mt-1 text-[10px] text-pretty text-fg-dim">{note}</p>}
    </div>
  );
}

export function EvidenceCoverageRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: EvidenceTone;
}) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const fraction = safeTotal > 0 ? Math.min(1, safeValue / safeTotal) : 0;
  const aria = `${label}: ${NUMBER.format(safeValue)} of ${NUMBER.format(safeTotal)} sessions`;

  return (
    <div title={aria}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[10px]">
        <span className="text-fg-muted">{label}</span>
        <span className={clsx("mono tabular-nums", LEGEND_TONE[tone])}>{NUMBER.format(safeValue)} / {NUMBER.format(safeTotal)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={aria}>
        <div
          aria-hidden="true"
          className="h-full rounded-full"
          style={{ width: `${fraction * 100}%`, background: SEGMENT_BACKGROUND[tone] }}
        />
      </div>
    </div>
  );
}
