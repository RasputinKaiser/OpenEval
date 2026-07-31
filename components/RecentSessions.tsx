"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import { fmtDateTime, fmtNum, fmtNumFull, fmtRel, fmtStableDateTime } from "@/lib/format";
import { compactDisplayPath } from "@/lib/redaction";
import { useRedactedShow } from "@/lib/use-redaction";

/** Dashboard recent-sessions list — client-side so titles and project paths obey the app-wide redaction preference. */
export default function RecentSessions({ sessions, referenceTimeMs }: { sessions: AllSourcesResult["sessions"]; referenceTimeMs?: number }) {
  const [nowMs, setNowMs] = useState<number | null>(referenceTimeMs ?? null);
  const harvestFrom = useMemo(() => sessions.flatMap((s) => [s.project, s.path]), [sessions]);
  const { redact, show } = useRedactedShow(harvestFrom);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

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

  return (
    <div className="divide-y divide-bd/50">
      {sessions.map((s, i) => {
        const inner = (
          <>
            <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] shrink-0">{s.sourceLabel}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{show(s.displayTitle || s.lastPromptPreview) || compactDisplayPath(s.project, redact)}</div>
              <div className="text-[11px] text-fg-dim mono truncate">
                {s.model ?? "model unknown"} · {fmtNum(s.toolCalls)} tools
                {s.toolErrors > 0 && <span className="text-err"> · {fmtNum(s.toolErrors)} failed</span>}
                {" · "}{compactDisplayPath(s.project, redact)}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm mono tabular-nums" title={fmtNumFull(s.inputTokens + s.outputTokens) + " tokens"}>{fmtNum(s.inputTokens + s.outputTokens)}</div>
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
          <Link key={`${s.sourceId}-${s.sessionId}-${i}`} href={`/collection/session?file=${encodeURIComponent(s.path)}`} className={clsx(cls, "recent-session-row -mx-2 px-2 hover:bg-bg-elev")}>
            {inner}
          </Link>
        ) : (
          <div key={`${s.sourceId}-${s.sessionId}-${i}`} className={cls}>{inner}</div>
        );
      })}
    </div>
  );
}
