"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderGit2,
  Layers,
  Loader2,
  MessageSquareText,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { compactDisplayPath } from "@/lib/redaction";
import { fmtDateTime, fmtStableDateTime, fmtTime } from "@/lib/format";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { LiveSession, LiveSessionDetailResult, LiveSessionListItem, LiveTranscriptTurn, MetricSource, TranscriptResult } from "@/lib/live";
import { collectionTranscriptHref, decimateUsageSegments, displayText, fmt, fmtBytes, fmtMs, fmtUsd } from "./live-shared";
import { IncidentBadges, ListStack, LoadingSkeletonRows, MetricGroup, QualityBadge, SourceChip, StatusPill, TinyMetric } from "./LivePrimitives";

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-bd bg-bg/45 p-4">
      <div className="mb-3 text-sm font-medium">{title}</div>
      {children}
    </section>
  );
}

const SOURCE_BORDER: Record<MetricSource, string> = {
  measured: "border-ok/15 bg-ok/5",
  inferred: "border-accent/15 bg-accent/5",
  missing: "border-warn/15 bg-warn/5",
  malformed: "border-err/15 bg-err/5",
};

function MetricCard({ label, value, source }: { label: string; value: string; source?: MetricSource }) {
  return (
    <div className={clsx("rounded-lg border border-bd bg-bg/45 p-3", source && SOURCE_BORDER[source])}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-fg-muted">
        <span>{label}</span>
        {source && <SourceChip label={source} source={source} />}
      </div>
      <div className="mono truncate text-base font-medium tabular-nums text-fg">{value}</div>
    </div>
  );
}

function SourceCell({ label, source }: { label: string; source: MetricSource }) {
  return (
    <div className={clsx("rounded border px-2 py-1.5", SOURCE_BORDER[source])}>
      <div className="text-[9px] uppercase tracking-wider text-fg-dim">{label}</div>
      <SourceChip label={source} source={source} />
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("mono text-sm font-semibold tabular-nums", tone === "err" && "text-err", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

function Timestamp({ ms, mounted, className }: { ms: number; mounted: boolean; className?: string }) {
  const stable = fmtStableDateTime(ms);
  return (
    <time className={className} dateTime={stable} title={fmtDateTime(ms)}>
      {mounted ? fmtTime(ms) : stable}
    </time>
  );
}

const TurnRow = React.memo(function TurnRow({ turn, redact, users, mounted }: { turn: LiveTranscriptTurn; redact: boolean; users: ReadonlySet<string>; mounted: boolean }) {
  return (
    <div className={clsx(
      "rounded-lg border p-3",
      turn.severity === "error" ? "border-err/40 bg-err/10" : turn.severity === "warning" ? "border-warn/40 bg-warn/10" : "border-bd bg-bg/45"
    )}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">{turn.label}</span>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] text-fg-dim">{turn.type}</span>
        {turn.at ? <Timestamp ms={turn.at} mounted={mounted} className="mono text-[10px] text-fg-dim" /> : null}
      </div>
      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-fg-muted">
        {displayText(turn.preview, redact, users)}
      </pre>
    </div>
  );
});

const UsageTimeline = React.memo(function UsageTimeline({ session, mounted }: { session: LiveSession; mounted: boolean }) {
  const segments = decimateUsageSegments(session.usageSegments);
  const sampled = segments.length < session.usageSegments.length;
  const maxOutput = Math.max(...segments.map((segment) => segment.cumulativeOutput), 1);
  return (
    <div className="space-y-2">
      {sampled ? (
        <div className="rounded border border-accent/20 bg-accent/5 px-3 py-2 text-[10px] text-fg-muted" role="status">
          Showing {segments.length} summarized points from {session.usageSegments.length}; adjacent usage records are merged and cumulative totals are preserved.
        </div>
      ) : null}
      {segments.map((segment, index) => {
        const width = Math.max(4, Math.round((segment.cumulativeOutput / maxOutput) * 100));
        const fastTok = segment.outTokPerSec > 50;
        const slowTok = segment.outTokPerSec < 10 && segment.outTokPerSec > 0;
        return (
          <div key={`${segment.atMs}-${index}`} className="rounded border border-bd-subtle bg-bg/40 p-2">
            <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-fg-muted">
              <Timestamp ms={segment.atMs} mounted={mounted} className="mono tabular-nums" />
              <span className={clsx("mono tabular-nums font-medium", fastTok ? "text-ok" : slowTok ? "text-warn" : "text-fg-muted")}>
                {fmt(segment.cumulativeOutput)} out · {segment.outTokPerSec.toFixed(1)} tok/s
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-bg-elev">
              <div
                className={clsx("h-full rounded transition-[width] duration-300", fastTok ? "bg-ok" : slowTok ? "bg-warn" : "bg-accent-soft")}
                style={{ width: `${width}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-fg-dim">
              +{fmt(segment.deltaInput)} input · +{fmt(segment.deltaOutput)} output
            </div>
          </div>
        );
      })}
    </div>
  );
});

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function listSessionPlaceholder(session: LiveSessionListItem): LiveSession {
  return {
    ...session,
    lastPromptPreview: null,
    modelUsage: [],
    usageSegments: [],
    toolSummaries: [],
    toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: session.modeSummary.gitBranch, entrypoint: null },
    staleMs: 0,
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion: null,
    outcomeSignals: { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 },
  };
}

function DetailFetchState({ status, error, onRetry }: { status: "loading" | "error" | "unavailable"; error?: string | null; onRetry: () => void }) {
  if (status === "loading") {
    return (
      <div role="status" aria-live="polite" className="rounded-lg border border-bd bg-bg/45 p-5 text-sm text-fg-muted">
        <div className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading full session detail…</div>
        <div className="mt-2 text-xs text-fg-dim">The list stays lightweight; trace, tool, usage, and file details load only for this drawer.</div>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-warn/30 bg-warn/10 p-5 text-sm text-warn">
      <div>{error ?? "Full session detail is unavailable."}</div>
      {status === "error" && (
        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded border border-warn/40 px-3 py-1.5 text-xs hover:bg-warn/10">
          <RefreshCwIcon /> Retry detail
        </button>
      )}
    </div>
  );
}

function RefreshCwIcon() {
  return <span aria-hidden="true">↻</span>;
}

export function SessionDrawer({
  session: listSession,
  redact,
  users,
  onClose,
  onNavigate,
  hasPrev,
  hasNext,
  getTranscript,
  getSessionDetail,
  harness,
}: {
  session: LiveSessionListItem;
  redact: boolean;
  users: ReadonlySet<string>;
  onClose: () => void;
  /** Move the drawer to the adjacent session in the current visible order. */
  onNavigate?: (delta: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  getTranscript?: (filePath: string, harness?: string) => Promise<TranscriptResult>;
  getSessionDetail?: (filePath: string, harness?: string) => Promise<LiveSessionDetailResult>;
  harness: string;
}) {
  const [turns, setTurns] = useState<LiveTranscriptTurn[] | null>(null);
  const [transcriptTruncated, setTranscriptTruncated] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [detailSession, setDetailSession] = useState<LiveSession | null>(null);
  const [detailStatus, setDetailStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const detailRequestRef = useRef(0);
  useFocusTrap(dialogRef, true);
  const detailsReady = detailSession?.path === listSession.path;
  const detailRefreshing = detailsReady && detailStatus === "loading";
  const detailRefreshFailed = detailsReady && (detailStatus === "error" || detailStatus === "unavailable");
  // A live row changes when an append changes its byte/line or summary metrics.
  // Refresh detail on those changes, but retain the last complete detail while
  // the request runs so polling never replaces trustworthy evidence with a
  // skeleton or a misleading empty placeholder.
  const detailRefreshKey = [
    listSession.path ?? "",
    listSession.lastEventAt,
    listSession.pathBytes,
    listSession.lineCount,
    listSession.toolCalls,
    listSession.toolErrors,
    listSession.hookErrors,
    listSession.isError,
    listSession.inputTokens,
    listSession.outputTokens,
    listSession.durationMs,
  ].join("\u0000");
  const detailRefreshKeyRef = useRef(detailRefreshKey);
  detailRefreshKeyRef.current = detailRefreshKey;
  const session = detailsReady && detailSession ? detailSession : listSessionPlaceholder(listSession);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const loadDetail = useCallback(async () => {
    const requestId = ++detailRequestRef.current;
    const requestedRefreshKey = detailRefreshKey;
    const requestedPath = listSession.path;
    setDetailError(null);
    if (!requestedPath || !getSessionDetail) {
      setDetailStatus("unavailable");
      setDetailError(!requestedPath ? "Full session detail is unavailable because this row has no source path." : "Full session detail loader is unavailable.");
      return;
    }
    setDetailStatus("loading");
    try {
      const result = await getSessionDetail(requestedPath, harness);
      if (requestId !== detailRequestRef.current || requestedRefreshKey !== detailRefreshKeyRef.current) return;
      if (result.session) {
        setDetailSession(result.session);
        setDetailStatus("ready");
      } else {
        setDetailStatus("error");
        setDetailError(result.error ?? "Full session detail is unavailable.");
      }
    } catch (e) {
      if (requestId !== detailRequestRef.current || requestedRefreshKey !== detailRefreshKeyRef.current) return;
      setDetailStatus("error");
      setDetailError(e instanceof Error ? e.message : String(e));
    }
  }, [detailRefreshKey, getSessionDetail, harness, listSession.path]);

  useEffect(() => {
    void loadDetail();
    return () => { detailRequestRef.current += 1; };
  }, [loadDetail]);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "Escape") {
        if (closing) return;
        setClosing(true);
        setTimeout(() => onCloseRef.current(), 180);
        return;
      }
      if (closing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        onNavigateRef.current?.(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        onNavigateRef.current?.(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing]);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onCloseRef.current(), 180);
  };

  // Tracks which transcript the current `turns` belong to, so a poll-driven
  // refresh of the SAME session updates in place instead of flashing the
  // loading skeleton every tick while the drawer is open.
  const loadedPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!getTranscript || !listSession.path) {
      loadedPathRef.current = listSession.path ?? null;
      if (!cancelled) setTurns([]);
      if (!cancelled) setTranscriptTruncated(false);
      return;
    }
    if (loadedPathRef.current !== listSession.path) setTurns(null);
    setTranscriptTruncated(false);
    setTranscriptError(null);
    const requestedPath = listSession.path;
    getTranscript(listSession.path, harness)
      .then((res) => {
        if (cancelled) return;
        loadedPathRef.current = requestedPath;
        if (res.error) {
          setTranscriptError(`Failed to parse session transcript: ${res.error}`);
          setTurns([]);
        } else {
          setTurns(res.turns);
          setTranscriptTruncated(Boolean(res.truncated));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          loadedPathRef.current = requestedPath;
          setTranscriptError(`Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}`);
          setTurns([]);
          setTranscriptTruncated(false);
        }
      });
    return () => { cancelled = true; };
  }, [listSession.path, getTranscript, harness]);

  const visible = mounted && !closing;
  const durationByName = new Map(session.toolDurations.map((d) => [d.name, d] as const));
  const transcriptHref = collectionTranscriptHref(session);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out"
        onClick={requestClose}
        style={{ opacity: visible ? 1 : 0 }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-drawer-title"
        className="relative flex h-full w-full flex-col overflow-hidden border-l border-bd bg-bg-subtle shadow-2xl md:max-w-2xl"
        style={{
          transform: visible ? "translateX(0)" : "translateX(16px)",
          opacity: visible ? 1 : 0,
          transition: "transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <div className="border-b border-bd-subtle bg-bg-subtle px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="session-drawer-title" className="text-lg font-semibold">Session details</h2>
                <QualityBadge value={listSession.dataQuality} />
                <StatusPill session={listSession} />
                <IncidentBadges session={listSession} />
              </div>
              <p className="mono mt-1 break-all text-xs text-fg-muted">{displayText(listSession.sessionId, redact, users)}</p>
            </div>
            {onNavigate && (
              <div className="flex shrink-0 items-center gap-1" title="Arrow keys also move between sessions">
                <button
                  type="button"
                  onClick={() => onNavigate(-1)}
                  disabled={!hasPrev}
                  aria-label="Previous session"
                  className="flex min-h-10 min-w-10 items-center justify-center rounded border border-bd text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate(1)}
                  disabled={!hasNext}
                  aria-label="Next session"
                  className="flex min-h-10 min-w-10 items-center justify-center rounded border border-bd text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            )}
            {transcriptHref && (
              <a
                href={transcriptHref}
                className="order-3 inline-flex min-h-10 basis-full items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:order-none md:basis-auto"
                title="Open the full transcript viewer for this session"
              >
                <FileText className="size-3.5" /> Full transcript
              </a>
            )}
            <button type="button" data-autofocus onClick={requestClose} aria-label="Close session details" className="rounded min-h-10 min-w-10 flex items-center justify-center hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X className="size-5 text-fg-muted" />
            </button>
          </div>
        </div>

        <div className="drawer-stagger flex-1 space-y-5 overflow-y-auto p-5">
          <section className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <MetricCard label="Project" value={compactDisplayPath(listSession.project || "(unknown)", redact)} />
            <MetricCard label="Model" value={displayText(listSession.model || "missing", redact, users)} source={listSession.metricSources.model} />
            <MetricCard label="Duration" value={listSession.metricSources.duration === "missing" ? "missing" : fmtMs(listSession.durationMs)} source={listSession.metricSources.duration} />
            <MetricCard label="Tokens" value={listSession.metricSources.tokens === "missing" ? "missing" : fmt(listSession.inputTokens + listSession.outputTokens)} source={listSession.metricSources.tokens} />
          </section>

          {detailRefreshing && (
            <div role="status" aria-live="polite" className="rounded border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-fg-muted">
              Refreshing session detail; showing the last complete detail until the live trace settles.
            </div>
          )}
          {detailRefreshFailed && (
            <div role="alert" className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
              <div>Latest session detail refresh failed; showing the last complete detail.</div>
              {detailError ? <div className="mt-1">{displayText(detailError, redact, users)}</div> : null}
              {detailStatus === "error" && (
                <button type="button" onClick={() => { void loadDetail(); }} className="mt-2 inline-flex items-center gap-2 rounded border border-warn/40 px-2.5 py-1.5 text-[11px] hover:bg-warn/10">
                  <RefreshCwIcon /> Retry detail
                </button>
              )}
            </div>
          )}

          {detailsReady ? <>
          <DetailPanel title="Usage">
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <TinyMetric label="Input" value={session.metricSources.tokens === "measured" ? fmt(session.inputTokens) : "missing"} />
              <TinyMetric label="Output" value={session.metricSources.tokens === "measured" ? fmt(session.outputTokens) : "missing"} />
              <TinyMetric label="Cache read" value={session.metricSources.tokens === "measured" ? fmt(session.cacheReadTokens) : "missing"} />
              <TinyMetric label="Cache create" value={session.metricSources.tokens === "measured" ? fmt(session.cacheCreateTokens) : "missing"} />
              <TinyMetric
                label={session.metricSources.cost === "inferred" ? "Est. cost" : "Cost"}
                value={session.metricSources.cost === "measured"
                  ? fmtUsd(session.costUsd)
                  : session.metricSources.cost === "inferred"
                    ? `~${fmtUsd(session.costUsd)}`
                    : "missing"}
              />
            </div>
            {session.usageSegments.length > 0 ? (
              <UsageTimeline session={session} mounted={mounted} />
            ) : (
              <div className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                Usage timeline unavailable because this trace did not report token segment data.
              </div>
            )}
          </DetailPanel>

          {(session.displayTitle || session.lastPromptPreview) && (
            <section className="rounded-lg border border-bd bg-bg/45 p-4">
              <div className="mb-2 text-sm font-medium">Session intent</div>
              {session.displayTitle ? <div className="text-sm text-fg">{displayText(session.displayTitle, redact, users)}</div> : null}
              {session.lastPromptPreview ? (
                <pre className="mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-fg-muted">
                  {displayText(session.lastPromptPreview, redact, users)}
                </pre>
              ) : null}
            </section>
          )}

          <section className="rounded-lg border border-bd bg-bg/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Metric provenance</div>
              <div className="text-xs text-fg-muted">{session.lineCount} parsed lines · {fmtBytes(session.pathBytes)}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
              {Object.entries(session.metricSources).map(([name, source]) => (
                <SourceCell key={name} label={name} source={source} />
              ))}
            </div>
            {session.parseWarnings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {session.parseWarnings.map((warning) => (
                  <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] text-warn">
                    {displayText(warning, redact, users)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricGroup label="Tooling">
              <MiniStat label="Tool calls" value={String(session.toolCalls)} icon={Wrench} />
              <MiniStat label="Tool errors" value={String(session.toolErrors)} icon={AlertTriangle} tone={session.toolErrors ? "err" : undefined} />
              <MiniStat label="Hook errors" value={String(session.hookErrors)} icon={ShieldAlert} tone={session.hookErrors ? "err" : undefined} />
            </MetricGroup>
            <MetricGroup label="Messages">
              <MiniStat label="Thinking" value={String(session.thinkingBlocks)} icon={Sparkles} />
              <MiniStat label="Text blocks" value={String(session.textBlocks)} icon={MessageSquareText} />
              <MiniStat label="Attachments" value={String(session.attachmentCount)} icon={Layers} />
            </MetricGroup>
            <MetricGroup label="History">
              <MiniStat label="Queue ops" value={String(session.queueOperationCount)} icon={Zap} tone={session.queueOperationCount ? "warn" : undefined} />
              <MiniStat label="Snapshots" value={String(session.snapshotCount)} icon={FolderGit2} />
            </MetricGroup>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DetailPanel title="Execution graph">
              <div className="grid grid-cols-2 gap-2">
                <TinyMetric label="Root msgs" value={fmt(session.traceGraph.rootMessages)} />
                <TinyMetric label="Side msgs" value={fmt(session.traceGraph.sidechainMessages)} />
                <TinyMetric label="Agents" value={fmt(session.traceGraph.agentCount)} />
                <TinyMetric label="Orphans" value={fmt(session.traceGraph.orphanMessages)} />
              </div>
            </DetailPanel>
            <DetailPanel title="Modes / repo">
              <div className="space-y-2 text-xs text-fg-muted">
                <div className="flex justify-between gap-3"><span>Branch</span><span className="mono truncate">{displayText(session.modeSummary.gitBranch ?? "missing", redact, users)}</span></div>
                <div className="flex justify-between gap-3"><span>Entrypoint</span><span className="mono">{displayText(session.modeSummary.entrypoint ?? "missing", redact, users)}</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(session.modeSummary.permissionModes).map(([mode, count]) => (
                    <span key={mode} className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px]">{displayText(mode, redact, users)}: {displayText(count, redact, users)}</span>
                  ))}
                </div>
              </div>
            </DetailPanel>
          </section>

          <DetailPanel title="Operator queue">
            <div className="mb-3 grid grid-cols-4 gap-2">
              <TinyMetric label="Enq" value={fmt(session.queueSummary.enqueue)} />
              <TinyMetric label="Deq" value={fmt(session.queueSummary.dequeue)} />
              <TinyMetric label="Rem" value={fmt(session.queueSummary.remove)} />
              <TinyMetric label="All" value={fmt(session.queueSummary.popAll)} />
            </div>
            <ListStack items={session.queueSummary.preview.map((preview, index) => ({
              key: `${index}-${preview}`,
              label: preview,
            }))} redact={redact} users={users} empty="No queued prompt previews." />
          </DetailPanel>

          <DetailPanel title="Tool breakdown">
            {session.toolSummaries.length === 0 ? (
              <div className="text-sm text-fg-muted">No tool calls found.</div>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-[minmax(0,1fr)_36px_36px_36px_36px_24px] gap-1 text-[8px] uppercase tracking-wider text-fg-dim sm:grid-cols-[minmax(0,1fr)_56px_56px_56px_56px_28px] sm:gap-2 sm:text-[9px]">
                  <span>Tool</span>
                  <span className="text-right">calls</span>
                  <span className="text-right">p50</span>
                  <span className="text-right">p95</span>
                  <span className="text-right">max</span>
                  <span className="text-right">err</span>
                </div>
                <div className="space-y-1.5">
                  {session.toolSummaries.map((tool) => {
                    const dur = durationByName.get(tool.name);
                    return (
                      <div key={tool.name} className="grid grid-cols-[minmax(0,1fr)_36px_36px_36px_36px_24px] items-center gap-1 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_56px_56px_56px_56px_28px] sm:gap-2 sm:py-1.5 sm:text-xs">
                        <span className="truncate mono text-[11px] text-fg" title={tool.name}>{tool.name}</span>
                        <span className="mono tabular-nums text-right text-fg-muted">{tool.calls}</span>
                        <span className="mono tabular-nums text-right text-fg-muted">{dur ? fmtMs(dur.p50Ms) : "—"}</span>
                        <span className="mono tabular-nums text-right text-fg-muted">{dur ? fmtMs(dur.p95Ms) : "—"}</span>
                        <span className="mono tabular-nums text-right text-fg-dim">{dur ? fmtMs(dur.maxMs) : "—"}</span>
                        <span className={clsx("mono tabular-nums text-right", tool.errors > 0 ? "text-err" : "text-fg-dim")}>{tool.errors}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </DetailPanel>

          <DetailPanel title="File / repo impact">
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <TinyMetric label="Touched" value={fmt(session.fileActivity.touchedFiles.length)} />
              <TinyMetric label="Read-ish" value={fmt(session.fileActivity.readLikeOperations)} />
              <TinyMetric label="Write-ish" value={fmt(session.fileActivity.writeLikeOperations)} />
              <TinyMetric label="Snapshots" value={fmt(session.snapshotCount)} />
            </div>
            <ListStack items={session.fileActivity.touchedFiles.map((filePath) => ({
              key: filePath,
              label: compactDisplayPath(filePath, redact),
            }))} redact={false} users={users} empty="No file paths inferred from tools or snapshots." />
          </DetailPanel>

          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              Timeline context
              {turns === null && <Loader2 className="size-4 animate-spin text-fg-muted" />}
            </div>
            {transcriptError ? (
              <div className="rounded-lg border border-warn/30 bg-warn/10 p-4 text-sm text-warn">{displayText(transcriptError, redact, users)}</div>
            ) : turns === null ? (
              <LoadingSkeletonRows />
            ) : turns.length === 0 ? (
              <div className="rounded-lg border border-bd bg-bg/45 p-4 text-sm text-fg-muted">No warning/error timeline context found.</div>
            ) : (
              <>
                {transcriptTruncated ? (
                  <div className="mb-2 rounded border border-accent/20 bg-accent/5 px-3 py-2 text-[10px] text-fg-muted" role="status">
                    Warning/error context was bounded to keep the drawer responsive; the source may contain additional turns.
                  </div>
                ) : null}
                <div className="space-y-2">
                  {turns.map((turn, i) => (
                    <TurnRow key={`${turn.type}-${i}`} turn={turn} redact={redact} users={users} mounted={mounted} />
                  ))}
                </div>
              </>
            )}
          </section>
          </> : <DetailFetchState
            status={detailStatus === "unavailable" ? "unavailable" : detailStatus === "error" ? "error" : "loading"}
            error={detailError ? displayText(detailError, redact, users) : detailError}
            onRetry={() => { void loadDetail(); }}
          />}
        </div>
      </div>
    </div>
  );
}
