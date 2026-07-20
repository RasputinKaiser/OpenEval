"use client";

import React from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, FileText, FolderGit2, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import { compactDisplayPath } from "@/lib/redaction";
import { Sparkline } from "@/components/Sparkline";
import type { LiveSession } from "@/lib/live";
import {
  collectionTranscriptHref,
  displayText,
  fmt,
  fmtMs,
  isSessionStale,
  needsAttention,
  relativeTime,
  sessionKey,
  shortId,
} from "./live-shared";
import { QualityBadge, SourceChip, StatusPill } from "./LivePrimitives";

const ROW_GRID = "md:grid-cols-[minmax(220px,1.7fr)_90px_100px_100px_90px_100px]";

export const SessionRow = React.memo(function SessionRow({ session, stale, redact, users, onSelect }: { session: LiveSession; stale: boolean; redact: boolean; users: ReadonlySet<string>; onSelect: (s: LiveSession) => void }) {
  const attention = needsAttention(session);
  const edgeColor = session.isError || session.toolErrors > 0 ? "bg-err" : session.hookErrors > 0 ? "bg-warn" : attention ? "bg-warn/50" : stale ? "bg-fg-dim" : "bg-ok/40";
  const transcriptHref = collectionTranscriptHref(session);
  return (
    // A div-with-button-role instead of <button> so the per-session transcript
    // link can nest inside without producing invalid button-in-button HTML.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session)}
      onKeyDown={(e) => {
        // Only when the row itself is focused — Enter on the nested
        // transcript link must activate the link, not open the drawer.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(session);
        }
      }}
      className={clsx(
        "cv-auto relative grid w-full cursor-pointer gap-3 pl-4 pr-4 py-3 text-left transition-colors hover:bg-bg-elev md:items-center",
        ROW_GRID,
        attention && "bg-warn/5"
      )}
    >
      <div className={clsx("absolute left-0 top-2 bottom-2 w-0.5 rounded-full", edgeColor)} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {attention ? <ShieldAlert className="size-4 shrink-0 text-warn" /> : <ShieldCheck className="size-4 shrink-0 text-ok" />}
          <span className="truncate text-sm font-medium">{compactDisplayPath(session.project || "(unknown)", redact)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-dim">
          <span className="mono">{shortId(session.sessionId)}</span>
          <span>·</span>
          {session.displayTitle ? (
            <>
              <span>{displayText(session.displayTitle, redact, users)}</span>
              <span>·</span>
            </>
          ) : null}
          <span>{displayText(session.model || "model missing", redact, users)}</span>
          {session.traceGraph.sidechainMessages > 0 ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent-soft">{session.traceGraph.sidechainMessages} side</span> : null}
          {session.traceGraph.agentCount > 0 ? <span className="rounded bg-bg-elev px-1.5 py-0.5 text-fg-muted">{session.traceGraph.agentCount} agent</span> : null}
          {session.modeSummary.gitBranch ? <span className="rounded bg-bg-elev px-1.5 py-0.5 text-fg-muted">{displayText(session.modeSummary.gitBranch, redact, users)}</span> : null}
          <span className={clsx(
            "rounded px-1.5 py-0.5 tabular-nums",
            session.metricSources.tokens === "measured" ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
          )}>
            {session.metricSources.tokens === "measured" ? `${fmt(session.totalTokens)} tok` : "usage missing"}
          </span>
          {session.usageSegments.length > 1 && (
            <Sparkline data={session.usageSegments.map((s) => s.outTokPerSec)} width={36} height={14} color="#a78bff" />
          )}
          {session.parseWarnings.slice(0, 2).map((warning) => (
            <span key={warning} className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{displayText(warning, redact, users)}</span>
          ))}
        </div>
      </div>
      <div className="text-xs text-fg-muted md:text-left">
        <div>{relativeTime(session.lastEventAt)}</div>
        <div className="mono text-[10px] tabular-nums text-fg-dim">{fmtMs(session.durationMs)}</div>
      </div>
      <QualityBadge value={session.dataQuality} />
      <div className="flex flex-wrap gap-1">
        <SourceChip label="model" source={session.metricSources.model} />
        <SourceChip label="tok" source={session.metricSources.tokens} />
        <SourceChip label="dur" source={session.metricSources.duration} />
      </div>
      <div className="flex items-center gap-2 text-xs md:justify-end">
        <span className="mono inline-flex items-center gap-1 text-fg-muted"><Wrench className="size-3" />{session.toolCalls}</span>
        <span className={clsx("mono inline-flex items-center gap-1", session.toolErrors > 0 ? "text-err" : "text-fg-muted")}>
          <AlertTriangle className="size-3" />{session.toolErrors}
        </span>
      </div>
      <div className="flex items-center gap-1.5 md:justify-end">
        <StatusPill session={session} stale={stale} />
        {transcriptHref && (
          <a
            href={transcriptHref}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-6 items-center rounded border border-bd px-1.5 py-0.5 text-fg-dim transition-colors hover:bg-bg-elev hover:text-fg"
            title="Open this session's transcript in Collection"
            aria-label="Open transcript in Collection"
          >
            <FileText className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
});

export function SessionTable({
  sessions,
  totalCount,
  redact,
  users,
  onSelect,
  controls,
}: {
  sessions: LiveSession[];
  totalCount: number;
  redact: boolean;
  users: ReadonlySet<string>;
  onSelect: (s: LiveSession) => void;
  controls: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-bd-subtle px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderGit2 className="size-4 text-fg-muted" /> Recent sessions
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            {sessions.length}/{totalCount} shown · values marked missing are not treated as zero-confidence measurements
          </div>
        </div>
        {controls}
      </div>

      <div className={clsx("hidden gap-3 border-b border-bd-subtle bg-bg-subtle px-4 py-2 text-[10px] uppercase tracking-wider text-fg-muted md:grid", ROW_GRID)}>
        <div>Session / project</div>
        <div>Freshness</div>
        <div>Quality</div>
        <div>Sources</div>
        <div className="text-right">Tools</div>
        <div className="text-right">Status</div>
      </div>

      <div className="scroll-contain max-h-[64vh] overflow-y-auto divide-y divide-bd-subtle">
        {sessions.map((session) => (
          <SessionRow
            key={sessionKey(session)}
            session={session}
            // Computed in the parent (which re-renders on each poll tick)
            // so a memo'd row still repaints when it crosses the 12h
            // stale boundary despite its reused session reference.
            stale={isSessionStale(session)}
            redact={redact}
            users={users}
            onSelect={onSelect}
          />
        ))}
        {sessions.length === 0 && (
          <div className="p-8 text-center text-sm text-fg-muted">No sessions match the current filter.</div>
        )}
      </div>
    </section>
  );
}
