"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { fmt } from "./live-shared";

/**
 * Daily volume chart: stacked input/output bars per day over the trailing
 * window, computed client-side from the already-parsed session list (no extra
 * fetch). Interactive: hover/focus a day to swap the header stat for that
 * day's exact split, mirroring the ActivityDayStrip contract.
 *
 * Honest-failure modes: sessions without finite timestamps are excluded from
 * the time axis (counted in the aria summary); a day with only cache activity
 * still renders (cache is the bar's third, dimmer segment).
 */
export function DailyVolumeChart({
  sessions,
  days = 30,
}: {
  sessions: Array<{ startedAt: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }>;
  days?: number;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // Cache reads dwarf input/output (2.76B vs 8.4M on real slices) — default OFF so the
  // work-bearing segments stay legible; the legend toggles them back on.
  const [showCache, setShowCache] = useState(false);

  const { buckets, excluded } = useMemo(() => {
    const dayMs = 86_400_000;
    const now = Date.now();
    const end = Math.floor(now / dayMs) * dayMs;
    const out: Array<{ start: number; input: number; output: number; cache: number }> = [];
    for (let i = days - 1; i >= 0; i -= 1) out.push({ start: end - i * dayMs, input: 0, output: 0, cache: 0 });
    let skipped = 0;
    const start0 = end - (days - 1) * dayMs;
    for (const s of sessions) {
      const input = Number.isFinite(s.inputTokens) ? Math.max(0, s.inputTokens) : 0;
      const output = Number.isFinite(s.outputTokens) ? Math.max(0, s.outputTokens) : 0;
      const cache = Number.isFinite(s.cacheReadTokens) ? Math.max(0, s.cacheReadTokens) : 0;
      if (input + output + cache === 0) continue; // no usage evidence — not a data point
      if (!Number.isFinite(s.startedAt) || s.startedAt <= 0) {
        skipped += 1;
        continue;
      }
      const idx = Math.floor((s.startedAt - start0) / dayMs);
      if (idx >= 0 && idx < days) {
        out[idx].input += input;
        out[idx].output += output;
        out[idx].cache += cache;
      }
    }
    return { buckets: out, excluded: skipped };
  }, [sessions, days]);

  const maxTotal = Math.max(1, ...buckets.map((b) => b.input + b.output + (showCache ? b.cache : 0)));
  const totalInput = buckets.reduce((sum, b) => sum + b.input, 0);
  const totalOutput = buckets.reduce((sum, b) => sum + b.output, 0);
  const active = activeIdx != null ? buckets[activeIdx] : null;
  const activeTotal = active ? active.input + active.output + active.cache : 0;
  const headerStat = active
    ? `${fmt(activeTotal)} tok · ${new Date(active.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : `${fmt(totalInput + totalOutput)} tok / ${days}d`;

  if (totalInput + totalOutput === 0) {
    return (
      <div className="rounded-md border border-dashed border-bd-subtle bg-bg-elev px-3 py-3 text-xs text-fg-muted" role="status">
        No usage evidence in the scanned slice for this time window.
      </div>
    );
  }

  return (
    <div onMouseLeave={() => setActiveIdx(null)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Volume · {days}d</span>
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
      <div className="mb-1 flex items-baseline justify-between text-[9px] tabular-nums text-fg-dim" aria-hidden>
        <span>{new Date(buckets[0].start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>peak {fmt(maxTotal)} tok/day</span>
        <span>today</span>
      </div>
      <div
        className="relative flex h-[64px] items-end gap-[2px] border-b border-bd-subtle pb-[2px]"
        role="img"
        aria-label={`Volume per day over the last ${days} days: ${fmt(totalInput)} input, ${fmt(totalOutput)} output${excluded ? `; ${excluded} sessions without timestamps excluded` : ""}`}
      >
        {/* Faint scale gridlines at 50% and 100% of the peak — heights become readable. */}
        {[50, 100].map((pct) => (
          <div key={pct} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-bd-subtle/60" style={{ bottom: `calc(2px + ${pct} * 0.01 * 62px * 0.96)` }} />
        ))}
        {buckets.map((b, idx) => {
          const total = b.input + b.output + (showCache ? b.cache : 0);
          const hIn = (b.input / maxTotal) * 62;
          const hOut = (b.output / maxTotal) * 62;
          const hCache = showCache ? (b.cache / maxTotal) * 62 : 0;
          return (
            <div key={b.start} role="presentation" className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setActiveIdx(idx)}>
              <button
                type="button"
                tabIndex={0}
                aria-label={`${new Date(b.start).toLocaleDateString()} — ${fmt(b.input)} input, ${fmt(b.output)} output`}
                onFocus={() => setActiveIdx(idx)}
                onBlur={() => setActiveIdx(null)}
                className="absolute inset-0 z-10 cursor-default rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              {/* Stacked, bottom-up: input (accent), output (ok), cache (dim cap). */}
              <div
                className={clsx(
                  "flex w-full flex-col justify-end transition-[filter] duration-150",
                  activeIdx === idx && total > 0 && "brightness-125",
                )}
                style={{ height: `${Math.max(total > 0 ? 3 : 1.5, hIn + hOut + hCache)}px` }}
              >
                {showCache && <div style={{ height: `${hCache}px`, background: "color-mix(in srgb, var(--color-accent) 22%, transparent)" }} />}
                <div style={{ height: `${hOut}px`, background: "var(--color-ok)", opacity: 0.85 }} />
                <div style={{ height: `${hIn}px`, background: "var(--color-accent)" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-fg-dim">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px]" style={{ background: "var(--color-accent)" }} /> input {fmt(totalInput)}</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px]" style={{ background: "var(--color-ok)", opacity: 0.85 }} /> output {fmt(totalOutput)}</span>
        <button
          type="button"
          onClick={() => setShowCache((v) => !v)}
          aria-pressed={showCache}
          className={clsx("inline-flex cursor-pointer items-center gap-1 rounded transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", showCache && "text-fg-muted")}
          title={showCache ? "Hide cache reads (they dwarf input/output)" : "Show cache reads"}
        >
          <span aria-hidden className="size-2 rounded-[2px] ring-1 ring-current/30" style={{ background: showCache ? "color-mix(in srgb, var(--color-accent) 22%, transparent)" : "transparent" }} />
          cache reads {showCache ? fmt(buckets.reduce((sum, b) => sum + b.cache, 0)) : "off"}
        </button>
      </div>
    </div>
  );
}
