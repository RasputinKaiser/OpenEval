"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Cpu,
  DollarSign,
  FolderGit2,
  Inbox,
  Loader2,
  RefreshCw,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { LiveAggregate, LiveSession, TranscriptResult } from "@/lib/live";

type LiveClientProps = {
  initialData?: LiveAggregate | null;
  error?: string;
  getTranscript?: (filePath: string) => Promise<TranscriptResult>;
};

export default function LiveClient({ initialData, error: initialError, getTranscript }: LiveClientProps) {
  const [data, setData] = useState<LiveAggregate | null>(initialData ?? null);
  const [error, setError] = useState<string | undefined>(initialError);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [selected, setSelected] = useState<LiveSession | null>(null);

  const lastSigRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = (await fetch("/api/live").then((r) => r.json())) as LiveAggregate;
        if (!cancelled) {
          const sig = `${d.totalSessions}:${d.totalToolCalls}:${d.totalToolErrors}:${d.sessions[0]?.sessionId ?? ""}`;
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

  if (loading && !data) return <LoadingSkeleton />;
  if (!data || data.totalSessions === 0) {
    return error ? <ErrorCard message={error} /> : <EmptyCard />;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="size-6 text-accent-soft" /> Live sessions
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Reads real ncode usage from <code className="mono text-xs">~/.ncode/projects</code>. Mode:{" "}
          <span className="text-accent-soft">Live eval</span> — monitor real usage, not synthetic cases.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <Stat label="Sessions" value={String(data.totalSessions)} icon={Activity} />
        <Stat label="Projects" value={String(data.totalProjects)} icon={FolderGit2} />
        <Stat label="Total cost" value={`$${data.totalCostUsd.toFixed(2)}`} icon={DollarSign} />
        <Stat label="Tokens in" value={fmt(data.totalInputTokens)} icon={Cpu} />
        <Stat label="Tokens out" value={fmt(data.totalOutputTokens)} icon={Cpu} />
        <Stat label="Tool calls" value={fmt(data.totalToolCalls)} icon={Wrench} />
        <Stat label="Tool errors" value={String(data.totalToolErrors)} icon={AlertTriangle} tone={data.totalToolErrors > 0 ? "err" : undefined} />
      </section>

      <section className="card overflow-hidden mb-4">
        <div className="px-4 py-2.5 border-b border-bd-subtle text-sm font-medium">Models</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Model</th>
                <th className="text-right px-4 py-2 font-medium">Sessions</th>
                <th className="text-right px-4 py-2 font-medium">Cost</th>
                <th className="text-right px-4 py-2 font-medium">Tokens</th>
                <th className="text-right px-4 py-2 font-medium">Tool calls</th>
                <th className="text-right px-4 py-2 font-medium">Errors</th>
                <th className="text-right px-4 py-2 font-medium">Avg dur</th>
                <th className="text-right px-4 py-2 font-medium">tok/s</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bd-subtle">
              {data.byModel.map((m) => {
                const totalTok = m.inputTokens + m.outputTokens;
                const tokPerSec = m.avgDurationMs > 0 ? m.outputTokens / (m.avgDurationMs / 1000) : 0;
                return (
                  <tr key={m.model} className="hover:bg-bg-elev">
                    <td className="px-4 py-2 font-mono text-xs break-all">{m.model}</td>
                    <td className="px-4 py-2 text-right mono">{m.sessions}</td>
                    <td className="px-4 py-2 text-right mono">${m.costUsd.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right mono">{fmt(totalTok)}</td>
                    <td className="px-4 py-2 text-right mono">{m.toolCalls}</td>
                    <td className="px-4 py-2 text-right mono" style={{ color: m.errors > 0 ? "#f85149" : undefined }}>{m.errors}</td>
                    <td className="px-4 py-2 text-right mono">{fmtMs(m.avgDurationMs)}</td>
                    <td className="px-4 py-2 text-right mono text-fg-muted">{tokPerSec.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-bd-subtle text-sm font-medium">Recent sessions</div>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-bd-subtle">
          {data.sessions.map((s) => (
            <SessionRow key={s.sessionId + s.project} s={s} onClick={() => setSelected(s)} />
          ))}
        </div>
      </section>

      {selected && <SessionDrawer session={selected} onClose={() => setSelected(null)} getTranscript={getTranscript} />}
    </div>
  );
}

function SessionRow({ s, onClick }: { s: LiveSession; onClick: () => void }) {
  const tokPerSec = s.durationMs > 0 ? s.outputTokens / (s.durationMs / 1000) : 0;
  const errRate = s.toolCalls > 0 ? s.toolErrors / s.toolCalls : 0;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-bg-elev cursor-pointer"
    >
      <span className="text-[10px] text-fg-dim mono w-5 shrink-0">{s.toolCalls > 0 ? "" : "•"}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{s.project || "(unknown)"}</div>
        <div className="text-[10px] text-fg-dim mono mt-0.5 truncate">
          {s.model || "—"} · {new Date(s.startedAt).toLocaleString()}
        </div>
      </div>
      <div className="hidden md:flex items-center gap-4 text-[11px] text-fg-muted shrink-0">
        <span className="mono flex items-center gap-1"><Zap className="size-3" />{tokPerSec.toFixed(1)}/s</span>
        <span className="mono flex items-center gap-1"><Cpu className="size-3" />{fmt(s.inputTokens + s.outputTokens)}</span>
        <span className="mono flex items-center gap-1"><DollarSign className="size-3" />${s.costUsd.toFixed(3)}</span>
        <span className="mono flex items-center gap-1"><Wrench className="size-3" />{s.toolCalls}</span>
        <span className="mono flex items-center gap-1" style={{ color: s.toolErrors > 0 ? "#f85149" : undefined }}>
          <AlertTriangle className="size-3" />{s.toolErrors}
        </span>
      </div>
      <span className={clsx("text-[10px] px-1.5 py-0.5 rounded mono shrink-0", s.isError ? "bg-err/10 text-err" : errRate > 0.3 ? "bg-warn/10 text-warn" : "bg-bg-elev text-fg-muted")}>
        {s.isError ? "error" : errRate > 0.3 ? "flaky" : "ok"}
      </span>
    </button>
  );
}

function SessionDrawer({
  session,
  onClose,
  getTranscript,
}: {
  session: LiveSession;
  onClose: () => void;
  getTranscript?: (filePath: string) => Promise<TranscriptResult>;
}) {
  const [turns, setTurns] = useState<unknown[] | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!getTranscript || !session.path) {
      if (!cancelled) { setTurns([]); }
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

  const okCalls = Math.max(0, session.toolCalls - session.toolErrors);
  const errPct = session.toolCalls > 0 ? (session.toolErrors / session.toolCalls) * 100 : 0;
  const okPct = session.toolCalls > 0 ? (okCalls / session.toolCalls) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg bg-bg-subtle border-l border-bd shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-bg-subtle border-b border-bd-subtle px-5 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Session details</h2>
            <p className="text-xs text-fg-muted mono mt-1 break-all">{session.sessionId}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-bg-elev rounded">
            <X className="size-5 text-fg-muted" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Project</div>
              <div className="mono text-fg truncate">{session.project || "(unknown)"}</div>
            </div>
            <div className="card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Model</div>
              <div className="mono text-fg truncate">{session.model || "—"}</div>
            </div>
            <div className="card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Cost</div>
              <div className="mono text-fg">${session.costUsd.toFixed(3)}</div>
            </div>
            <div className="card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Duration</div>
              <div className="mono text-fg">{fmtMs(session.durationMs)}</div>
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Tool calls vs errors</div>
              <div className="text-xs text-fg-muted mono">
                {session.toolErrors} / {session.toolCalls}  error{session.toolErrors === 1 ? "" : "s"}
              </div>
            </div>
            {session.toolCalls > 0 ? (
              <div className="h-2 bg-bg-elev rounded overflow-hidden flex">
                <div className="bg-ok h-full" style={{ width: `${okPct}%` }} />
                <div className="bg-err h-full" style={{ width: `${errPct}%` }} />
              </div>
            ) : (
              <div className="text-xs text-fg-muted">No tool calls recorded.</div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-3 flex items-center gap-2">
              Erroring turns
              {turns === null && <Loader2 className="size-4 animate-spin text-fg-muted" />}
            </div>
            {transcriptError ? (
              <div className="card p-4 border-l-4 border-warn text-sm text-warn">{transcriptError}</div>
            ) : turns === null ? (
              <LoadingSkeletonRows />
            ) : turns.length === 0 ? (
              <div className="card p-4 text-sm text-fg-muted">No erroring turns found.</div>
            ) : (
              <div className="space-y-2">
                {turns.map((turn, i) => (
                  <TurnRow key={i} turn={turn} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TurnRow({ turn }: { turn: unknown }) {
  if (!turn || typeof turn !== "object") {
    return <div className="card p-3 text-xs text-fg-muted mono">Invalid turn</div>;
  }
  const o = turn as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "unknown";
  const subtype = typeof o.subtype === "string" ? o.subtype : undefined;
  const preview = JSON.stringify(turn).slice(0, 240);
  return (
    <div className="card p-3 border-l-4 border-err">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">Turn {type}</span>
        {subtype && <span className="text-[10px] text-fg-dim mono">/{subtype}</span>}
      </div>
      <pre className="text-[11px] text-fg-muted mono whitespace-pre-wrap overflow-x-auto">{preview}</pre>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <div className="h-8 w-64 bg-bd-subtle rounded animate-pulse mb-2" />
        <div className="h-4 w-96 bg-bd-subtle rounded animate-pulse" />
      </header>
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="card p-3">
            <div className="h-3 w-16 bg-bd-subtle rounded animate-pulse mb-2" />
            <div className="h-6 w-20 bg-bd-subtle rounded animate-pulse" />
          </div>
        ))}
      </section>
      <LoadingSkeletonRows />
    </div>
  );
}

function LoadingSkeletonRows() {
  return (
    <div className="card divide-y divide-bd-subtle overflow-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-3">
          <div className="h-4 w-4 bg-bd-subtle rounded animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 bg-bd-subtle rounded animate-pulse" />
            <div className="h-3 w-1/2 bg-bd-subtle rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyCard() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="card p-8 flex flex-col items-center text-center">
        <Inbox className="size-10 text-fg-muted mb-4" />
        <h2 className="text-lg font-medium mb-2">No live sessions found yet</h2>
        <p className="text-sm text-fg-muted max-w-md">
          Sessions will appear here as <code className="mono text-xs">~/.ncode/projects/</code> accumulates{" "}
          <code className="mono text-xs">.jsonl</code> traces.
        </p>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="card p-8 flex flex-col items-center text-center border-err/30">
        <AlertCircle className="size-10 text-err mb-4" />
        <h2 className="text-lg font-medium mb-2">Could not load live sessions</h2>
        <p className="text-sm text-fg-muted mb-4 max-w-lg break-words">{message}</p>
        <p className="text-xs text-fg-dim mb-4">
          Check that the directory exists and is readable. The page will retry automatically every 10 seconds.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-elev hover:bg-bg-subtle border border-bd rounded"
        >
          <RefreshCw className="size-4" /> Retry now
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" }) {
  const c = tone === "err" ? "text-err" : "text-fg";
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className={`text-lg font-semibold mono ${c}`}>{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n > 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}
