"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownWideNarrow,
  BarChart3,
  CheckCircle2,
  Clock3,
  Cpu,
  DollarSign,
  Eye,
  EyeOff,
  Filter,
  FolderGit2,
  Gauge,
  Inbox,
  Layers,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { compactDisplayPath, redactSensitiveText } from "@/lib/redaction";
import type { LiveAggregate, LiveMetricSources, LiveSession, LiveTranscriptTurn, MetricSource, TranscriptResult } from "@/lib/live";

type LiveClientProps = {
  initialData?: LiveAggregate | null;
  error?: string;
  getTranscript?: (filePath: string) => Promise<TranscriptResult>;
};

type FilterMode = "all" | "attention" | "stale" | "missing";
type SortMode = "recent" | "quality" | "errors";

const REDACT_STORAGE_KEY = "neval.live.redactUsernames";

export default function LiveClient({ initialData, error: initialError, getTranscript }: LiveClientProps) {
  const [data, setData] = useState<LiveAggregate | null>(initialData ?? null);
  const [error, setError] = useState<string | undefined>(initialError);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [selected, setSelected] = useState<LiveSession | null>(null);
  const [redact, setRedact] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("recent");

  const lastSigRef = useRef("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REDACT_STORAGE_KEY);
      if (stored === "0") setRedact(false);
      if (stored === "1") setRedact(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(REDACT_STORAGE_KEY, redact ? "1" : "0");
    } catch {}
  }, [redact]);

  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = (await fetch("/api/live").then((r) => r.json())) as LiveAggregate;
        if (!cancelled) {
          const sig = `${d.totalSessions}:${d.totalToolCalls}:${d.totalToolErrors}:${d.sessions[0]?.sessionId ?? ""}:${d.avgDataQuality}`;
          if (sig !== lastSigRef.current) {
            lastSigRef.current = sig;
            setData(d);
          }
          if (d.totalSessions > 0) setError(undefined);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          t = setTimeout(poll, 10000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const visibleSessions = useMemo(() => {
    const sessions = data?.sessions ?? [];
    const filtered = sessions.filter((session) => {
      if (filter === "attention") return needsAttention(session);
      if (filter === "stale") return session.staleMs > staleThresholdMs();
      if (filter === "missing") return Object.values(session.metricSources).some((source) => source === "missing" || source === "malformed");
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "quality") return a.dataQuality - b.dataQuality || b.lastEventAt - a.lastEventAt;
      if (sort === "errors") return b.toolErrors - a.toolErrors || b.hookErrors - a.hookErrors || b.lastEventAt - a.lastEventAt;
      return b.lastEventAt - a.lastEventAt;
    });
  }, [data, filter, sort]);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data || data.totalSessions === 0) {
    return error ? <ErrorCard message={error} /> : <EmptyCard warnings={data?.scanWarnings ?? []} />;
  }

  const toolErrorRate = data.totalToolCalls > 0 ? data.totalToolErrors / data.totalToolCalls : 0;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-normal">
            <Activity className="size-6 text-accent-soft" /> Live sessions
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">
            Real ncode traces from <code className="mono text-xs">~/.ncode/projects</code>, with metric provenance, parser confidence,
            and copy-safe redaction for local usernames.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRedact((value) => !value)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
              redact ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
            )}
          >
            {redact ? <Lock className="size-4" /> : <Eye className="size-4" />}
            REDACT {redact ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-md border border-bd bg-bg-elev px-3 py-2 text-xs text-fg-muted hover:text-fg"
          >
            <RefreshCw className="size-4" /> Refresh
          </button>
        </div>
      </header>

      {data.scanWarnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {data.scanWarnings.map((warning) => <div key={warning}>{displayText(warning, redact)}</div>)}
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Sessions" value={String(data.totalSessions)} icon={Activity} />
        <Stat label="Quality" value={`${Math.round(data.avgDataQuality)}%`} icon={Gauge} tone={qualityTone(data.avgDataQuality)} />
        <Stat label="Measured dur" value={`${data.sessionsWithMeasuredDuration}/${data.totalSessions}`} icon={Timer} />
        <Stat label="Unknown model" value={String(data.sessionsWithMissingModel)} icon={Cpu} tone={data.sessionsWithMissingModel ? "warn" : undefined} />
        <Stat label="Tokens missing" value={String(data.sessionsWithMissingTokens)} icon={Layers} tone={data.sessionsWithMissingTokens ? "warn" : undefined} />
        <Stat label="Tool err rate" value={`${Math.round(toolErrorRate * 100)}%`} icon={AlertTriangle} tone={toolErrorRate ? "err" : undefined} />
        <Stat label="Stale" value={String(data.staleSessions)} icon={Clock3} tone={data.staleSessions ? "warn" : undefined} />
        <Stat label="Malformed" value={String(data.sessionsWithMalformedLines)} icon={ShieldAlert} tone={data.sessionsWithMalformedLines ? "err" : undefined} />
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.8fr]">
        <ModelPanel data={data} />
        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-bd-subtle px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <FolderGit2 className="size-4 text-fg-muted" /> Recent sessions
              </div>
              <div className="mt-1 text-xs text-fg-muted">
                {visibleSessions.length}/{data.sessions.length} shown · values marked missing are not treated as zero-confidence measurements
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SelectPill icon={Filter} value={filter} onChange={(v) => setFilter(v as FilterMode)} options={[
                ["all", "All"],
                ["attention", "Attention"],
                ["stale", "Stale"],
                ["missing", "Missing"],
              ]} />
              <SelectPill icon={ArrowDownWideNarrow} value={sort} onChange={(v) => setSort(v as SortMode)} options={[
                ["recent", "Recent"],
                ["quality", "Quality"],
                ["errors", "Errors"],
              ]} />
            </div>
          </div>

          <div className="hidden grid-cols-[minmax(220px,1.7fr)_90px_100px_100px_90px_80px] gap-3 border-b border-bd-subtle bg-bg-subtle px-4 py-2 text-[10px] uppercase tracking-wider text-fg-muted md:grid">
            <div>Session / project</div>
            <div>Freshness</div>
            <div>Quality</div>
            <div>Sources</div>
            <div className="text-right">Tools</div>
            <div className="text-right">Status</div>
          </div>

          <div className="max-h-[64vh] overflow-y-auto divide-y divide-bd-subtle">
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.sessionId + session.project}
                session={session}
                redact={redact}
                onClick={() => setSelected(session)}
              />
            ))}
            {visibleSessions.length === 0 && (
              <div className="p-8 text-center text-sm text-fg-muted">No sessions match the current filter.</div>
            )}
          </div>
        </section>
      </section>

      {selected && (
        <SessionDrawer
          session={selected}
          redact={redact}
          onClose={() => setSelected(null)}
          getTranscript={getTranscript}
        />
      )}
    </div>
  );
}

function ModelPanel({ data }: { data: LiveAggregate }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-bd-subtle px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="size-4 text-fg-muted" /> Model evidence
        </div>
        <div className="mt-1 text-xs text-fg-muted">Unknown rows mean the trace did not report model metadata.</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[10px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Sessions</th>
              <th className="px-4 py-2 text-right font-medium">Quality</th>
              <th className="px-4 py-2 text-right font-medium">Missing</th>
              <th className="px-4 py-2 text-right font-medium">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd-subtle">
            {data.byModel.map((model) => (
              <tr key={model.model} className="hover:bg-bg-elev">
                <td className="px-4 py-2">
                  <span className="mono text-xs">{model.model}</span>
                </td>
                <td className="px-4 py-2 text-right mono">{model.sessions}</td>
                <td className="px-4 py-2 text-right">
                  <QualityBadge value={model.avgDataQuality} />
                </td>
                <td className="px-4 py-2 text-right text-xs text-fg-muted">
                  {model.missingTokens + model.missingCost ? `${model.missingTokens} token / ${model.missingCost} cost` : "—"}
                </td>
                <td className={clsx("px-4 py-2 text-right mono", model.errors > 0 && "text-err")}>{model.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SessionRow({ session, redact, onClick }: { session: LiveSession; redact: boolean; onClick: () => void }) {
  const attention = needsAttention(session);
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-elev md:grid-cols-[minmax(220px,1.7fr)_90px_100px_100px_90px_80px] md:items-center",
        attention && "bg-warn/5"
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {attention ? <ShieldAlert className="size-4 shrink-0 text-warn" /> : <ShieldCheck className="size-4 shrink-0 text-ok" />}
          <span className="truncate text-sm font-medium">{compactDisplayPath(session.project || "(unknown)", redact)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-dim">
          <span className="mono">{shortId(session.sessionId)}</span>
          <span>·</span>
          <span>{session.model || "model missing"}</span>
          {session.parseWarnings.slice(0, 2).map((warning) => (
            <span key={warning} className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{displayText(warning, redact)}</span>
          ))}
        </div>
      </div>
      <div className="text-xs text-fg-muted md:text-left">
        <div>{relativeTime(session.lastEventAt)}</div>
        <div className="mono text-[10px] text-fg-dim">{fmtMs(session.durationMs)}</div>
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
      <StatusPill session={session} />
    </button>
  );
}

function SessionDrawer({
  session,
  redact,
  onClose,
  getTranscript,
}: {
  session: LiveSession;
  redact: boolean;
  onClose: () => void;
  getTranscript?: (filePath: string) => Promise<TranscriptResult>;
}) {
  const [turns, setTurns] = useState<LiveTranscriptTurn[] | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!getTranscript || !session.path) {
      if (!cancelled) setTurns([]);
      return;
    }
    setTurns(null);
    setTranscriptError(null);
    getTranscript(session.path)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setTranscriptError(`Failed to parse session transcript: ${res.error}`);
          setTurns([]);
        } else {
          setTurns(res.turns);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setTranscriptError(`Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}`);
          setTurns([]);
        }
      });
    return () => { cancelled = true; };
  }, [session, getTranscript]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col overflow-hidden border-l border-bd bg-bg-subtle shadow-2xl md:max-w-2xl">
        <div className="border-b border-bd-subtle bg-bg-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Session details</h2>
                <QualityBadge value={session.dataQuality} />
                <StatusPill session={session} />
              </div>
              <p className="mono mt-1 break-all text-xs text-fg-muted">{displayText(session.sessionId, redact)}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded p-1.5 hover:bg-bg-elev">
              <X className="size-5 text-fg-muted" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <section className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <MetricCard label="Project" value={compactDisplayPath(session.project || "(unknown)", redact)} />
            <MetricCard label="Model" value={session.model || "missing"} source={session.metricSources.model} />
            <MetricCard label="Duration" value={session.metricSources.duration === "missing" ? "missing" : fmtMs(session.durationMs)} source={session.metricSources.duration} />
            <MetricCard label="Tokens" value={session.metricSources.tokens === "missing" ? "missing" : fmt(session.inputTokens + session.outputTokens)} source={session.metricSources.tokens} />
          </section>

          <section className="rounded-lg border border-bd bg-bg/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Metric provenance</div>
              <div className="text-xs text-fg-muted">{session.lineCount} parsed lines · {fmtBytes(session.pathBytes)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {Object.entries(session.metricSources).map(([name, source]) => (
                <SourceCell key={name} label={name} source={source} />
              ))}
            </div>
            {session.parseWarnings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {session.parseWarnings.map((warning) => (
                  <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] text-warn">
                    {displayText(warning, redact)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="Tool calls" value={String(session.toolCalls)} icon={Wrench} />
            <MiniStat label="Tool errors" value={String(session.toolErrors)} icon={AlertTriangle} tone={session.toolErrors ? "err" : undefined} />
            <MiniStat label="Thinking" value={String(session.thinkingBlocks)} icon={Sparkles} />
            <MiniStat label="Text blocks" value={String(session.textBlocks)} icon={MessageSquareText} />
            <MiniStat label="Attachments" value={String(session.attachmentCount)} icon={Layers} />
            <MiniStat label="Queue ops" value={String(session.queueOperationCount)} icon={Zap} tone={session.queueOperationCount ? "warn" : undefined} />
            <MiniStat label="Snapshots" value={String(session.snapshotCount)} icon={FolderGit2} />
            <MiniStat label="Hook errors" value={String(session.hookErrors)} icon={ShieldAlert} tone={session.hookErrors ? "err" : undefined} />
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              Timeline context
              {turns === null && <Loader2 className="size-4 animate-spin text-fg-muted" />}
            </div>
            {transcriptError ? (
              <div className="rounded-lg border border-warn/30 bg-warn/10 p-4 text-sm text-warn">{displayText(transcriptError, redact)}</div>
            ) : turns === null ? (
              <LoadingSkeletonRows />
            ) : turns.length === 0 ? (
              <div className="rounded-lg border border-bd bg-bg/45 p-4 text-sm text-fg-muted">No warning/error timeline context found.</div>
            ) : (
              <div className="space-y-2">
                {turns.map((turn, i) => (
                  <TurnRow key={`${turn.type}-${i}`} turn={turn} redact={redact} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TurnRow({ turn, redact }: { turn: LiveTranscriptTurn; redact: boolean }) {
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
        {displayText(turn.preview, redact)}
      </pre>
    </div>
  );
}

function SelectPill({ icon: Icon, value, onChange, options }: { icon: any; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-bd bg-bg-elev px-2 py-1.5 text-xs text-fg-muted">
      <Icon className="size-3.5" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs text-fg outline-none"
      >
        {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
      </select>
    </label>
  );
}

function MetricCard({ label, value, source }: { label: string; value: string; source?: MetricSource }) {
  return (
    <div className="rounded-lg border border-bd bg-bg/45 p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mono truncate text-sm text-fg">{value}</div>
      {source ? <div className="mt-1"><SourceChip label={source} source={source} /></div> : null}
    </div>
  );
}

function SourceCell({ label, source }: { label: string; source: MetricSource }) {
  return (
    <div className="rounded bg-bg-elev/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-fg-dim">{label}</div>
      <SourceChip label={source} source={source} />
    </div>
  );
}

function SourceChip({ label, source }: { label: string; source: MetricSource }) {
  return (
    <span className={clsx(
      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px]",
      source === "measured" && "bg-ok/10 text-ok",
      source === "inferred" && "bg-accent/10 text-accent-soft",
      source === "missing" && "bg-warn/10 text-warn",
      source === "malformed" && "bg-err/10 text-err"
    )}>
      {label}
    </span>
  );
}

function QualityBadge({ value }: { value: number }) {
  return (
    <span className={clsx(
      "inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-[11px] mono",
      value >= 80 ? "bg-ok/10 text-ok" : value >= 55 ? "bg-warn/10 text-warn" : "bg-err/10 text-err"
    )}>
      <Gauge className="size-3" /> {Math.round(value)}%
    </span>
  );
}

function StatusPill({ session }: { session: LiveSession }) {
  const stale = session.staleMs > staleThresholdMs();
  if (session.isError || session.toolErrors > 0 || session.hookErrors > 0) {
    return <span className="w-fit rounded bg-err/10 px-2 py-1 text-[10px] mono text-err">error</span>;
  }
  if (stale) return <span className="w-fit rounded bg-warn/10 px-2 py-1 text-[10px] mono text-warn">stale</span>;
  return <span className="w-fit rounded bg-ok/10 px-2 py-1 text-[10px] mono text-ok">ok</span>;
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" | "warn" | "ok" }) {
  return (
    <div className="card p-3">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("mono text-lg font-semibold", tone === "err" && "text-err", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" | "warn" }) {
  return (
    <div className="rounded-lg border border-bd bg-bg/45 p-3">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("mono text-base font-semibold", tone === "err" && "text-err", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <header className="mb-6">
        <div className="mb-2 h-8 w-64 animate-pulse rounded bg-bd-subtle" />
        <div className="h-4 w-96 animate-pulse rounded bg-bd-subtle" />
      </header>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card p-3">
            <div className="mb-2 h-3 w-16 animate-pulse rounded bg-bd-subtle" />
            <div className="h-6 w-20 animate-pulse rounded bg-bd-subtle" />
          </div>
        ))}
      </section>
      <LoadingSkeletonRows />
    </div>
  );
}

function LoadingSkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-bd bg-bg-subtle">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
          <div className="h-4 w-4 animate-pulse rounded bg-bd-subtle" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-bd-subtle" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-bd-subtle" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ warnings }: { warnings: string[] }) {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="card flex flex-col items-center p-8 text-center">
        <Inbox className="mb-4 size-10 text-fg-muted" />
        <h2 className="mb-2 text-lg font-medium">No live sessions found yet</h2>
        <p className="max-w-md text-sm text-fg-muted">
          Sessions will appear here as <code className="mono text-xs">~/.ncode/projects/</code> accumulates{" "}
          <code className="mono text-xs">.jsonl</code> traces.
        </p>
        {warnings.length > 0 && (
          <div className="mt-4 rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">{warnings.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="card flex flex-col items-center border-err/30 p-8 text-center">
        <AlertCircle className="mb-4 size-10 text-err" />
        <h2 className="mb-2 text-lg font-medium">Could not load live sessions</h2>
        <p className="mb-4 max-w-lg break-words text-sm text-fg-muted">{redactSensitiveText(message)}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded border border-bd bg-bg-elev px-3 py-1.5 text-sm hover:bg-bg-subtle"
        >
          <RefreshCw className="size-4" /> Retry now
        </button>
      </div>
    </div>
  );
}

function displayText(value: unknown, redact: boolean): string {
  return redact ? redactSensitiveText(value) : String(value ?? "");
}

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-5)}`;
}

function needsAttention(session: LiveSession): boolean {
  return session.isError || session.toolErrors > 0 || session.hookErrors > 0 || session.dataQuality < 70 || session.malformedLineCount > 0;
}

function staleThresholdMs(): number {
  return 1000 * 60 * 60 * 12;
}

function qualityTone(value: number): "ok" | "warn" | "err" {
  if (value >= 80) return "ok";
  if (value >= 55) return "warn";
  return "err";
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}
