"use client";

import { useMemo } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import { fmtNum, fmtNumFull, fmtRel } from "@/lib/format";
import { compactDisplayPath } from "@/lib/redaction";
import { useRedactedShow } from "@/lib/use-redaction";

/** Dashboard recent-sessions list — client-side so titles and project paths obey the app-wide redaction preference. */
export default function RecentSessions({ sessions }: { sessions: AllSourcesResult["sessions"] }) {
  const harvestFrom = useMemo(() => sessions.flatMap((s) => [s.project, s.path]), [sessions]);
  const { redact, show } = useRedactedShow(harvestFrom);

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
              <div className="text-[11px] text-fg-dim mono truncate">{s.model ?? "model unknown"} · {compactDisplayPath(s.project, redact)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm mono tabular-nums" title={fmtNumFull(s.inputTokens + s.outputTokens) + " tokens"}>{fmtNum(s.inputTokens + s.outputTokens)}</div>
              <div className="text-[11px] text-fg-dim mono tabular-nums">{fmtRel(s.lastEventAt)}</div>
            </div>
          </>
        );
        const cls = "py-2 flex items-center gap-3 min-w-0";
        return s.path ? (
          <Link key={`${s.sourceId}-${s.sessionId}-${i}`} href={`/collection/session?file=${encodeURIComponent(s.path)}`} className={clsx(cls, "hover:bg-bg-elev/40 -mx-2 px-2 rounded transition-colors")}>
            {inner}
          </Link>
        ) : (
          <div key={`${s.sourceId}-${s.sessionId}-${i}`} className={cls}>{inner}</div>
        );
      })}
    </div>
  );
}
