"use client";

import { useMemo, useState } from "react";
import { fmt } from "./live-shared";
import { buildDailyVolume, type DailyVolumeSession } from "@/lib/daily-volume";
import { ChartFrame } from "../charts/ChartFrame";

export function DailyVolumeChart({ sessions, days = 30, onExplore, referenceTime }: {
  sessions: DailyVolumeSession[]; days?: number; referenceTime?: number;
  onExplore?: (fromMs: number, toMs: number) => void;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [showCache, setShowCache] = useState(false);
  const { buckets, excluded } = useMemo(() => buildDailyVolume(sessions, days, referenceTime), [sessions, days, referenceTime]);
  const totalInput = buckets.reduce((sum, b) => sum + b.input, 0);
  const totalOutput = buckets.reduce((sum, b) => sum + b.output, 0);
  const totalCache = buckets.reduce((sum, b) => sum + b.cache, 0);
  const includeCache = showCache || totalInput + totalOutput === 0;
  const max = Math.max(1, ...buckets.map((b) => b.input + b.output + (includeCache ? b.cache : 0)));
  const active = buckets[pinnedIdx ?? activeIdx ?? -1];
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const table = { headers: ["Day (UTC)", "Input", "Output", "Cache reads", "Usage sessions"], rows: buckets.map((b) => ({ id: String(b.start), cells: [date(b.start), fmt(b.input), fmt(b.output), fmt(b.cache), b.sessions] })) };
  return <ChartFrame title={`Daily usage · ${buckets.length} days`} unit="Tokens by session start day (UTC) · scanned session slice" table={table}
    actions={<label className="analysis-control"><input type="checkbox" checked={includeCache} disabled={totalInput + totalOutput === 0} onChange={(e) => setShowCache(e.target.checked)} />Include cache reads</label>}>
    {totalInput + totalOutput + totalCache === 0 ? <p role="status" className="py-3 text-xs text-fg-muted">No usage evidence in the scanned slice for this time window.</p> : <>
      <div className="mb-3 min-h-10 text-xs text-fg-muted" aria-live="polite">{active ? `${date(active.start)} · ${fmt(active.input)} input · ${fmt(active.output)} output · ${fmt(active.cache)} cache reads · ${active.sessions} usage sessions` : `${fmt(totalInput)} input · ${fmt(totalOutput)} output · ${fmt(totalCache)} cache reads`}</div>
      <div className="relative flex h-32 items-end gap-1 border-b border-bd-subtle" onMouseLeave={() => setActiveIdx(null)} aria-label="Daily usage values">
        {buckets.map((bucket, i) => <button key={bucket.start} type="button" className="group relative h-full min-w-0 flex-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`${date(bucket.start)}: ${fmt(bucket.input)} input, ${fmt(bucket.output)} output, ${fmt(bucket.cache)} cache reads`} aria-pressed={pinnedIdx === i}
          onMouseEnter={() => setActiveIdx(i)} onFocus={() => setActiveIdx(i)} onBlur={() => setActiveIdx(null)} onClick={() => setPinnedIdx(pinnedIdx === i ? null : i)}>
          <span className="absolute bottom-0 inset-x-0 flex flex-col justify-end" aria-hidden>
            {includeCache && <span style={{ height: `${bucket.cache / max * 120}px`, background: "var(--color-fg-muted)", opacity: .6 }} />}
            <span style={{ height: `${bucket.output / max * 120}px`, background: "var(--color-ok)" }} />
            <span style={{ height: `${bucket.input / max * 120}px`, background: "var(--color-accent)" }} />
          </span>
        </button>)}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-fg-muted"><span>{date(buckets[0].start)}</span><span>Peak {fmt(max)} tokens/day</span><span>{date(buckets[buckets.length - 1].start)}</span></div>
      {pinnedIdx !== null && active && <div className="mt-3 flex flex-wrap gap-2">{onExplore && <button type="button" className="analysis-control" onClick={() => onExplore(active.start, active.start + 86_400_000)}>Explore sessions from this day</button>}<button type="button" className="analysis-control" onClick={() => setPinnedIdx(null)}>Clear inspection</button></div>}
      {totalInput + totalOutput === 0 && totalCache > 0 && <p className="mt-2 text-xs text-fg-muted">Only cache-read usage is reported in this window.</p>}
    </>}
    {excluded > 0 && <p className="mt-2 text-xs text-warn">{excluded} usage sessions lack a valid start timestamp and are excluded.</p>}
  </ChartFrame>;
}
