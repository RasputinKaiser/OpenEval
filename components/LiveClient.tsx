"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Activity, AlertTriangle, Cpu, DollarSign, FolderGit2, Layers, Zap, Wrench } from "lucide-react";
import type { LiveAggregate, LiveSession } from "@/lib/live";

export default function LiveClient() {
  const [data, setData] = useState<LiveAggregate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await fetch("/api/live").then((r) => r.json());
        if (!cancelled) setData(d);
      } finally {
        if (!cancelled) { setLoading(false); t = setTimeout(poll, 10000); }
      }
    };
    poll();
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  if (loading && !data) return <div className="p-8 text-fg-muted">Scanning ~/.ncode sessions…</div>;
  if (!data || data.totalSessions === 0) return <div className="p-8 text-fg-muted">No ncode sessions found in ~/.ncode/projects.</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="size-6 text-accent-soft" /> Live sessions
        </h1>
        <p className="text-sm text-fg-muted mt-1">Reads real ncode usage from <code className="mono text-xs">~/.ncode/projects</code>. Mode: <span className="text-accent-soft">Live eval</span> — monitor real usage, not synthetic cases.</p>
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
                const tokPerSec = m.avgDurationMs > 0 ? (m.outputTokens) / (m.avgDurationMs / 1000) : 0;
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
            <SessionRow key={s.sessionId + s.project} s={s} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SessionRow({ s }: { s: LiveSession }) {
  const tokPerSec = s.durationMs > 0 ? s.outputTokens / (s.durationMs / 1000) : 0;
  const errRate = s.toolCalls > 0 ? s.toolErrors / s.toolCalls : 0;
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-bg-elev">
      <span className="text-[10px] text-fg-dim mono w-5 shrink-0">{s.toolCalls > 0 ? "" : "•"}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{s.project || "(unknown)"}</div>
        <div className="text-[10px] text-fg-dim mono mt-0.5 truncate">{s.model || "—"} · {new Date(s.startedAt).toLocaleString()}</div>
      </div>
      <div className="hidden md:flex items-center gap-4 text-[11px] text-fg-muted shrink-0">
        <span className="mono flex items-center gap-1"><Zap className="size-3" />{tokPerSec.toFixed(1)}/s</span>
        <span className="mono flex items-center gap-1"><Cpu className="size-3" />{fmt(s.inputTokens + s.outputTokens)}</span>
        <span className="mono flex items-center gap-1"><DollarSign className="size-3" />${s.costUsd.toFixed(3)}</span>
        <span className="mono flex items-center gap-1"><Wrench className="size-3" />{s.toolCalls}</span>
        <span className="mono flex items-center gap-1" style={{ color: s.toolErrors > 0 ? "#f85149" : undefined }}><AlertTriangle className="size-3" />{s.toolErrors}</span>
      </div>
      <span className={clsx("text-[10px] px-1.5 py-0.5 rounded mono shrink-0", s.isError ? "bg-err/10 text-err" : errRate > 0.3 ? "bg-warn/10 text-warn" : "bg-bg-elev text-fg-muted")}>
        {s.isError ? "error" : errRate > 0.3 ? "flaky" : "ok"}
      </span>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" }) {
  const c = tone === "err" ? "text-err" : "text-fg";
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted mb-1"><Icon className="size-3" /> {label}</div>
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