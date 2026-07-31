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
      <div
        className="flex h-2 overflow-hidden rounded-full bg-bg-elev"
        role="img"
        aria-label={aria}
        title={aria}
      >
        {denominator > 0 && clean.map((segment) => (
          segment.value > 0 ? (
            <span
              key={`${segment.label}-${segment.tone}`}
              aria-hidden="true"
              className="h-full min-w-0"
              style={{
                width: `${(segment.value / denominator) * 100}%`,
                background: SEGMENT_BACKGROUND[segment.tone],
              }}
            />
          ) : null
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {clean.map((segment) => (
          <span key={`${segment.label}-${segment.tone}`} className={clsx("inline-flex items-center gap-1 text-[10px]", LEGEND_TONE[segment.tone])}>
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px] ring-1 ring-current/20"
              style={{ background: SEGMENT_BACKGROUND[segment.tone] }}
            />
            <span className="text-fg-muted">{segment.label}</span>
            <span className="mono tabular-nums">{NUMBER.format(segment.value)}</span>
          </span>
        ))}
      </div>
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
