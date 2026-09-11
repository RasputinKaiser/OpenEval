"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, ArrowUpDown } from "lucide-react";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import { fmtDateTime, fmtDuration, fmtNum, fmtNumFull, fmtRel, fmtStableDateTime } from "@/lib/format";
import { compactDisplayPath } from "@/lib/redaction";
import { useRedactedShow } from "@/lib/use-redaction";

type SortKey = "recent" | "tokens" | "duration";

/**
 * Dashboard recent-sessions list — client-side so titles and project paths obey the
 * app-wide redaction preference, and so harness filtering + sorting stay instant
 * (no fetch): the dashboard slice is already in memory.
 */
export default function RecentSessions({ sessions, referenceTimeMs }: { sessions: AllSourcesResult["sessions"]; referenceTimeMs?: number }) {
  const [nowMs, setNowMs] = useState<number | null>(referenceTimeMs ?? null);
  const [harnessFilter, setHarnessFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const harvestFrom = useMemo(() => sessions.flatMap((s) => [s.project, s.path]), [sessions]);
  const { redact, show } = useRedactedShow(harvestFrom);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const harnesses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.sourceLabel, (counts.get(s.sourceLabel) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const visible = useMemo(() => {
    const filtered = harnessFilter ? sessions.filter((s) => s.sourceLabel === harnessFilter) : sessions;
    const sorted = [...filtered];
    if (sortKey === "tokens") sorted.sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
    if (sortKey === "duration") sorted.sort((a, b) => b.durationMs - a.durationMs);
    // "recent" keeps the server order (already lastEventAt DESC).
    return sorted;
  }, [sessions, harnessFilter, sortKey]);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="text-sm text-fg-dim">No sessions discovered yet.</div>
        <div className="text-xs text-fg-dim mt-1.5">
          Transcripts from any harness on this machine appear here automatically —{" "}
          <Link href="/live" className="text-accent-soft hover:underline">watch detection on Live</Link>.
        </div>
      </div>
    );
  }

  const chipCls = (active: boolean) =>
    clsx(
      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      active ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev hover:text-fg",
    );

  return (
    <div>
      {/* Harness filter + sort — instant, client-side, URL-free (dashboard glance scope). */}
      {harnesses.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setHarnessFilter(null)} className={chipCls(harnessFilter === null)} aria-pressed={harnessFilter === null}>
            All · {sessions.length}
          </button>
          {harnesses.map(([label, count]) => (
            <button key={label} type="button" onClick={() => setHarnessFilter(label)} className={chipCls(harnessFilter === label)} aria-pressed={harnessFilter === label}>
              {label} · {count}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <ArrowUpDown aria-hidden="true" className="size-3 text-fg-dim" />
            {([["recent", "Recent"], ["tokens", "Tokens"], ["duration", "Duration"]] as Array<[SortKey, string]>).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setSortKey(key)} className={chipCls(sortKey === key)} aria-pressed={sortKey === key}>
                {label}
              </button>
            ))}
          </span>
        </div>
      )}
    <div className="divide-y divide-bd/50">
      {visible.map((s, i) => {
        const tokens = s.inputTokens + s.outputTokens;
        const inner = (
          <>
            <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] shrink-0">{s.sourceLabel}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{show(s.displayTitle || s.lastPromptPreview) || compactDisplayPath(s.project, redact)}</div>
              <div className="text-[11px] text-fg-dim mono truncate flex items-center gap-1.5">
                <span className="truncate">{s.model ?? "model unknown"} · {fmtNum(s.toolCalls)} tools
                {s.toolErrors > 0 && <span className="text-err"> · {fmtNum(s.toolErrors)} failed</span>}</span>
                {s.durationMs > 0 && <span className="shrink-0 text-fg-dim">· {fmtDuration(s.durationMs)}</span>}
              </div>
            </div>
            <div
              className="hidden sm:grid place-items-center shrink-0"
              title={`Data quality ${Math.round(s.dataQuality)}%`}
              aria-label={`Data quality ${Math.round(s.dataQuality)}%`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-bg-elev)" strokeWidth="2.5" />
                <circle
                  cx="9" cy="9" r="7" fill="none"
                  stroke={s.dataQuality >= 80 ? "var(--color-ok)" : s.dataQuality >= 55 ? "var(--color-warn)" : "var(--color-err)"}
                  strokeWidth="2.5"
                  strokeDasharray={`${(Math.max(0, Math.min(100, s.dataQuality)) / 100) * 44} 44`}
                  transform="rotate(-90 9 9)"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm mono tabular-nums" title={fmtNumFull(tokens) + " tokens"}>{fmtNum(tokens)}</div>
              <time
                className="text-[11px] text-fg-dim mono tabular-nums"
                dateTime={fmtStableDateTime(s.lastEventAt)}
                title={fmtDateTime(s.lastEventAt)}
              >
                {nowMs === null ? fmtStableDateTime(s.lastEventAt) : fmtRel(s.lastEventAt, nowMs)}
              </time>
            </div>
            {s.path && <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-dim opacity-0 transition-[opacity,transform,color] group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-accent-soft group-hover:opacity-100 group-focus-visible:opacity-100" />}
          </>
        );
        const cls = "group flex min-h-14 min-w-0 items-center gap-3 rounded-lg py-2.5 outline-none transition-colors focus-visible:bg-bg-elev focus-visible:ring-2 focus-visible:ring-accent";
        return s.path ? (
          <Link key={`${s.sourceId}-${s.sessionId}-${i}`} href={`/collection/session?sourceId=${encodeURIComponent(s.sourceId)}&sessionId=${encodeURIComponent(s.sessionId)}`} className={clsx(cls, "recent-session-row -mx-2 px-2 hover:bg-bg-elev")}>
            {inner}
          </Link>
        ) : (
          <div key={`${s.sourceId}-${s.sessionId}-${i}`} className={cls}>{inner}</div>
        );
      })}
      {visible.length === 0 && (
        <div className="py-8 text-center text-sm text-fg-dim">No sessions from {harnessFilter} in the dashboard slice.</div>
      )}
    </div>
    </div>
  );
}
