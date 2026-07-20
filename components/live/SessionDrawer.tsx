"use client";

import React, { useEffect, useRef, useState } from "react";
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
import type { LiveSession, LiveTranscriptTurn, MetricSource, TranscriptResult } from "@/lib/live";
import { collectionTranscriptHref, displayText, fmt, fmtBytes, fmtMs } from "./live-shared";
import { ListStack, LoadingSkeletonRows, MetricGroup, QualityBadge, SourceChip, StatusPill, TinyMetric } from "./LivePrimitives";

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-bd bg-bg/45 p-4">
      <div className="mb-3 text-sm font-medium">{title}</div>
      {children}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string; source?: MetricSource }) {
  return (
    <div className="rounded-lg border border-bd bg-bg/45 p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mono truncate text-base font-medium tabular-nums text-fg">{value}</div>
    </div>
  );
}

const SOURCE_BORDER: Record<MetricSource, string> = {
  measured: "border-ok/15 bg-ok/5",
  inferred: "border-accent/15 bg-accent/5",
  missing: "border-warn/15 bg-warn/5",
  malformed: "border-err/15 bg-err/5",
};

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

const TurnRow = React.memo(function TurnRow({ turn, redact, users }: { turn: LiveTranscriptTurn; redact: boolean; users: ReadonlySet<string> }) {
  return (
    <div className={clsx(
      "rounded-lg border p-3",
      turn.severity === "error" ? "border-err/40 bg-err/10" : turn.severity === "warning" ? "border-warn/40 bg-warn/10" : "border-bd bg-bg/45"
    )}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">{turn.label}</span>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] text-fg-dim">{turn.type}</span>
        {turn.at ? <span className="mono text-[10px] text-fg-dim">{new Date(turn.at).toLocaleTimeString()}</span> : null}
      </div>
      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-fg-muted">
        {displayText(turn.preview, redact, users)}
      </pre>
    </div>
  );
});

function UsageTimeline({ session }: { session: LiveSession }) {
  const maxOutput = Math.max(...session.usageSegments.map((segment) => segment.cumulativeOutput), 1);
  return (
    <div className="space-y-2">
      {session.usageSegments.map((segment, index) => {
        const width = Math.max(4, Math.round((segment.cumulativeOutput / maxOutput) * 100));
        const fastTok = segment.outTokPerSec > 50;
        const slowTok = segment.outTokPerSec < 10 && segment.outTokPerSec > 0;
        return (
          <div key={`${segment.atMs}-${index}`} className="rounded border border-bd-subtle bg-bg/40 p-2">
            <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-fg-muted">
              <span className="mono tabular-nums">{new Date(segment.atMs).toLocaleTimeString()}</span>
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
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function SessionDrawer({
  session,
  redact,
  users,
  onClose,
  onNavigate,
  hasPrev,
  hasNext,
  getTranscript,
  harness,
}: {
  session: LiveSession;
  redact: boolean;
  users: ReadonlySet<string>;
  onClose: () => void;
  /** Move the drawer to the adjacent session in the current visible order. */
  onNavigate?: (delta: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  getTranscript?: (filePath: string, harness?: string) => Promise<TranscriptResult>;
  harness: string;
}) {
  const [turns, setTurns] = useState<LiveTranscriptTurn[] | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
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
    if (!getTranscript || !session.path) {
      loadedPathRef.current = session.path ?? null;
      if (!cancelled) setTurns([]);
      return;
    }
    if (loadedPathRef.current !== session.path) setTurns(null);
    setTranscriptError(null);
    const requestedPath = session.path;
    getTranscript(session.path, harness)
      .then((res) => {
        if (cancelled) return;
        loadedPathRef.current = requestedPath;
        if (res.error) {
          setTranscriptError(`Failed to parse session transcript: ${res.error}`);
          setTurns([]);
        } else {
          setTurns(res.turns);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          loadedPathRef.current = requestedPath;
          setTranscriptError(`Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}`);
          setTurns([]);
        }
      });
    return () => { cancelled = true; };
  }, [session, getTranscript, harness]);

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
        role="dialog"
        aria-modal="true"
        aria-label="Session details"
        className="relative flex h-full w-full flex-col overflow-hidden border-l border-bd bg-bg-subtle shadow-2xl md:max-w-2xl"
        style={{
          transform: visible ? "translateX(0)" : "translateX(16px)",
          opacity: visible ? 1 : 0,
          transition: "transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <div className="border-b border-bd-subtle bg-bg-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Session details</h2>
                <QualityBadge value={session.dataQuality} />
                <StatusPill session={session} />
              </div>
              <p className="mono mt-1 break-all text-xs text-fg-muted">{displayText(session.sessionId, redact, users)}</p>
            </div>
            {onNavigate && (
              <div className="flex shrink-0 items-center gap-1" title="Arrow keys also move between sessions">
                <button
                  type="button"
                  onClick={() => onNavigate(-1)}
                  disabled={!hasPrev}
                  aria-label="Previous session"
                  className="flex min-h-8 min-w-8 items-center justify-center rounded border border-bd text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate(1)}
                  disabled={!hasNext}
                  aria-label="Next session"
                  className="flex min-h-8 min-w-8 items-center justify-center rounded border border-bd text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            )}
            {transcriptHref && (
              <a
                href={transcriptHref}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors"
                title="Open the full transcript viewer for this session"
              >
                <FileText className="size-3.5" /> Full transcript
              </a>
            )}
            <button type="button" onClick={requestClose} aria-label="Close session details" className="rounded min-h-10 min-w-10 flex items-center justify-center hover:bg-bg-elev">
              <X className="size-5 text-fg-muted" />
            </button>
          </div>
        </div>

        <div className="drawer-stagger flex-1 space-y-5 overflow-y-auto p-5">
          <section className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <MetricCard label="Project" value={compactDisplayPath(session.project || "(unknown)", redact)} />
            <MetricCard label="Model" value={displayText(session.model || "missing", redact, users)} source={session.metricSources.model} />
            <MetricCard label="Duration" value={session.metricSources.duration === "missing" ? "missing" : fmtMs(session.durationMs)} source={session.metricSources.duration} />
            <MetricCard label="Tokens" value={session.metricSources.tokens === "missing" ? "missing" : fmt(session.inputTokens + session.outputTokens)} source={session.metricSources.tokens} />
          </section>

          <DetailPanel title="Usage">
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <TinyMetric label="Input" value={session.metricSources.tokens === "measured" ? fmt(session.inputTokens) : "missing"} />
              <TinyMetric label="Output" value={session.metricSources.tokens === "measured" ? fmt(session.outputTokens) : "missing"} />
              <TinyMetric label="Cache read" value={session.metricSources.tokens === "measured" ? fmt(session.cacheReadTokens) : "missing"} />
              <TinyMetric label="Cache create" value={session.metricSources.tokens === "measured" ? fmt(session.cacheCreateTokens) : "missing"} />
              <TinyMetric
                label={session.metricSources.cost === "inferred" ? "Est. cost" : "Cost"}
                value={session.metricSources.cost === "measured"
                  ? `$${session.costUsd.toFixed(4)}`
                  : session.metricSources.cost === "inferred"
                    ? `~$${session.costUsd.toFixed(4)}`
                    : "missing"}
              />
            </div>
            {session.usageSegments.length > 0 ? (
              <UsageTimeline session={session} />
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
                <div className="mb-3 grid grid-cols-[1fr_56px_56px_56px_56px_28px] gap-2 text-[9px] uppercase tracking-wider text-fg-dim">
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
                      <div key={tool.name} className="grid grid-cols-[1fr_56px_56px_56px_56px_28px] items-center gap-2 py-1.5 text-xs">
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
              <div className="space-y-2">
                {turns.map((turn, i) => (
                  <TurnRow key={`${turn.type}-${i}`} turn={turn} redact={redact} users={users} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
