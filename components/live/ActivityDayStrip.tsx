"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";

/**
 * Goal-S1 style day strip: session starts bucketed per day for the trailing
 * window, rendered as vertical columns. Pure client computation from the
 * already-parsed session list — no extra fetch. Columns are keyboard-focusable
 * and a live value chip follows hover/focus, so the interaction works without
 * a pointer (title attributes alone are invisible on touch and keyboard).
 */
export function ActivityDayStrip({
  startedAts,
  days = 30,
  color = "var(--color-accent)",
}: {
  startedAts: number[];
  days?: number;
  color?: string;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const buckets = useMemo(() => {
    const valid = startedAts.filter((t) => Number.isFinite(t) && t > 0);
    if (valid.length === 0) return null;
    const dayMs = 86_400_000;
    const now = Date.now();
    const end = Math.floor(now / dayMs) * dayMs;
    const out: Array<{ start: number; count: number }> = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      out.push({ start: end - i * dayMs, count: 0 });
    }
    for (const t of valid) {
      const idx = Math.floor((t - (end - (days - 1) * dayMs)) / dayMs);
      if (idx >= 0 && idx < days) out[idx].count += 1;
    }
    return out;
  }, [startedAts, days]);

  if (!buckets) {
    return (
      <div className="rounded-md border border-dashed border-bd-subtle bg-bg-elev px-3 py-3 text-xs text-fg-muted" role="status">
        No session timestamps available for an activity strip.
      </div>
    );
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const activeDays = buckets.filter((b) => b.count > 0).length;
  const active = activeIdx != null ? buckets[activeIdx] : null;
  const activeLabel = active
    ? `${new Date(active.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${active.count} session${active.count === 1 ? "" : "s"}`
    : null;

  return (
    <div onMouseLeave={() => setActiveIdx(null)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Session activity · {days}d</span>
        {/* The chip swaps to the hovered/focused day's exact count; falls back to the summary. */}
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-colors duration-150",
            active ? "bg-accent/15 text-accent-soft" : "text-fg-dim",
          )}
          aria-live="polite"
        >
          {activeLabel ?? `${activeDays}/${days} days active`}
        </span>
      </div>
      {/* Date anchors: first / mid / last bucket — the reader can place activity in time. */}
      <div className="mb-1 flex justify-between text-[9px] tabular-nums text-fg-dim" aria-hidden>
        <span>{new Date(buckets[0].start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>{new Date(buckets[Math.floor(days / 2)].start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>peak {max} session{max === 1 ? "" : "s"}/day · today</span>
      </div>
      <div
        className="flex h-[38px] items-end gap-[2px]"
        role="img"
        aria-label={`Sessions per day over the last ${days} days: ${activeDays} active days`}
      >
        {buckets.map((b, idx) => (
          <div
            key={b.start}
            role="presentation"
            className="group relative flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setActiveIdx(idx)}
          >
            {/* Keyboard/touch path: the column itself is focusable; focus and hover
                drive the same chip. A padded transparent layer guarantees the
                44px-ish touch target without stretching the visible bar. */}
            <button
              type="button"
              tabIndex={0}
              aria-label={`${new Date(b.start).toLocaleDateString()} — ${b.count} session${b.count === 1 ? "" : "s"}`}
              onFocus={() => setActiveIdx(idx)}
              onBlur={() => setActiveIdx(null)}
              className="absolute inset-0 z-10 cursor-default rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <div
              className={clsx(
                "w-full rounded-t-[2px] transition-[height,opacity,background-color] duration-150",
                b.count === 0 && "opacity-50",
                activeIdx === idx && b.count > 0 && "brightness-125",
              )}
              style={{ height: `${b.count === 0 ? 2 : Math.max(4, (b.count / max) * 34)}px`, background: b.count === 0 ? "var(--color-bd-subtle)" : color }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
