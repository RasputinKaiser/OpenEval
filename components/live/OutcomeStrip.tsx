"use client";

import { useState } from "react";
import clsx from "clsx";
import { fmt } from "./live-shared";
import type { LiveAggregateList } from "@/lib/live";

/**
 * Outcome signals strip: transcript-derived session outcomes aggregated
 * scan-side (positive/negative acks, rephrase loops, tests-passed tails,
 * error tails). One horizontal 100% stacked bar + hoverable segments.
 *
 * Honest framing: these are heuristic text signals, not judgments — the label
 * and aria copy say so. "No signal" is a real class, not filler.
 */
export function OutcomeStrip({ counts, total }: { counts: LiveAggregateList["outcomeCounts"]; total: number }) {
  const [active, setActive] = useState<string | null>(null);

  const segments = [
    { id: "positive", label: "positive ack", value: counts.positive, color: "var(--color-ok)" },
    { id: "tests", label: "tests passed", value: counts.testsPassed, color: "color-mix(in srgb, var(--color-ok) 55%, transparent)" },
    { id: "rephrase", label: "rephrased", value: counts.rephrases, color: "var(--color-warn)" },
    { id: "negative", label: "negative ack", value: counts.negative, color: "var(--color-err)" },
    { id: "error", label: "error tail", value: counts.errorTail, color: "color-mix(in srgb, var(--color-err) 45%, transparent)" },
  ].filter((s) => s.value > 0);
  const noSignal = counts.noSignal > 0
    ? { id: "none", label: "no signal", value: counts.noSignal, color: "var(--color-bg-elev)" }
    : null;

  if (total === 0) {
    return (
      <div className="rounded-md border border-dashed border-bd-subtle bg-bg-elev px-3 py-3 text-xs text-fg-muted" role="status">
        No sessions parsed — outcome signals need a populated slice.
      </div>
    );
  }

  const all = [...segments, ...(noSignal ? [noSignal] : [])];
  const activeSeg = all.find((s) => s.id === active) ?? null;
  const headerStat = activeSeg
    ? `${activeSeg.label}: ${activeSeg.value} of ${total} (${Math.round((activeSeg.value / total) * 100)}%)`
    : `${total} sessions · heuristic signals`;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Outcome signals</span>
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-colors duration-150",
            activeSeg ? "bg-accent/15 text-accent-soft" : "text-fg-dim",
          )}
          aria-live="polite"
        >
          {headerStat}
        </span>
      </div>
      <div
        className={clsx(
          "relative flex overflow-hidden rounded-full bg-bg-elev",
          all.length === 1 && "h-5",
        )}
        role="img"
        aria-label={`Heuristic outcome signals across ${total} sessions: ${all.map((s) => `${s.value} ${s.label}`).join(", ")}. Derived from transcript text, not judgments.`}
      >
        {all.map((s) => (
          <button
            key={s.id}
            type="button"
            tabIndex={0}
            aria-label={`${s.label}: ${s.value} of ${total} sessions`}
            onMouseEnter={() => setActive(s.id)}
            onFocus={() => setActive(s.id)}
            onBlur={() => setActive(null)}
            className={clsx(
              "h-full min-w-[2px] cursor-default transition-[filter,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              active && active !== s.id && "opacity-40",
            )}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
        {all.length === 1 && (
          <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] font-medium text-fg-muted">
            {all[0].label} · {total} of {total} sessions
          </span>
        )}
      </div>
      <div className={clsx("flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-fg-dim", "mt-1")}>
        {all.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label} {fmt(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}
