"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Activity, Cpu, DollarSign, Gauge, Hash, Layers, Timer, Wrench, Zap, AlertTriangle,
  ArrowUp, ArrowDown,
} from "lucide-react";
import type { RunTelemetry } from "@/lib/types";
import { useVisibilityPoll } from "@/lib/use-visibility-poll";

interface PerCase {
  caseId: string; caseName: string; category: string; status: string;
  tokPerSec: number; inTokPerSec: number; toolCallCount: number;
  errorCount: number; cacheHitRate: number; tokensPerCase: number;
  costPerCase: number; msPerTurn: number; msPerTool: number;
  durationMs: number; model: string | null; numTurns: number;
  toolDurationCoverage: number;
  durationSource: "runner_wall" | "cli_result" | "missing";
  tokenSource: "cli_usage" | "missing";
  toolSource: "stream_tool_events" | "summary_counts" | "missing";
  throughputMode: "output_tokens_per_runner_wall_second";
  warnings: string[];
}

interface Props { runId: string; runName: string; }

export default function BenchClient({ runId, runName }: Props) {
  const [telemetry, setTelemetry] = useState<RunTelemetry | null>(null);
  const [perCase, setPerCase] = useState<PerCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<keyof PerCase>("tokPerSec");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: keyof PerCase) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  useVisibilityPoll(
    async () => {
      try {
        const r = await fetch(`/api/runs/${runId}/telemetry`).then((res) => res.json());
        setTelemetry(r.telemetry);
        setPerCase(r.perCase || []);
      } finally {
        setLoading(false);
      }
    },
    3000,
    [runId],
  );

  const cases = useMemo(() => {
    const sorted = [...perCase].sort((a, b) => {
      let av: any = (a as any)[sortKey];
      let bv: any = (b as any)[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = av ?? 0; bv = bv ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [perCase, sortKey, sortDir]);

  if (loading && !telemetry) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-6 h-7 w-48 shimmer rounded" />
        <section className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
              <div className="h-3 w-20 shimmer rounded" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between gap-2">
                  <div className="h-3 w-24 shimmer rounded" />
                  <div className="h-4 w-12 shimmer rounded" />
                </div>
              ))}
            </div>
          ))}
        </section>
        <div className="card p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-bd-subtle last:border-0">
              <div className="h-3 w-32 shimmer rounded" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-full shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const t = telemetry;
  const maxTokPerSec = Math.max(1, ...cases.map((c) => c.tokPerSec));
  const maxTokens = Math.max(1, ...cases.map((c) => c.tokensPerCase));
  const maxCost = Math.max(0.0001, ...cases.map((c) => c.costPerCase));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <Link href={`/runs/${runId}`} className="text-xs text-fg-muted hover:text-fg">← Back to run</Link>
        <h1 className="text-2xl font-semibold mt-1">{runName}</h1>
        <div className="text-xs text-fg-dim mono mt-1">Benchmark & telemetry · {runId}</div>
      </header>

      {t && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <MetricGroup label="Throughput">
              <Stat label="Avg tok/s" value={t.avgTokPerSec.toFixed(1)} icon={Gauge} tone="accent" />
              <Stat label="Max tok/s" value={t.maxTokPerSec.toFixed(1)} icon={Zap} />
              <Stat label="P50 tok/s" value={t.p50TokPerSec.toFixed(1)} icon={Zap} />
            </MetricGroup>
            <MetricGroup label="Latency & volume">
              <Stat label="P50 duration" value={fmtMs(t.p50DurationMs)} icon={Timer} />
              <Stat label="P95 duration" value={fmtMs(t.p95DurationMs)} icon={Timer} tone={t.p95DurationMs > 60000 ? "warn" : undefined} />
              <Stat label="Avg turns" value={t.avgTurns.toFixed(1)} icon={Hash} />
            </MetricGroup>
            <MetricGroup label="Reliability">
              <Stat label="Cache hit" value={`${(t.cacheHitRate * 100).toFixed(0)}%`} icon={Layers} tone={t.cacheHitRate > 0.3 ? "ok" : undefined} />
              <Stat label="Error rate" value={`${(t.errorRate * 100).toFixed(0)}%`} icon={AlertTriangle} tone={t.errorRate > 0 ? "err" : "ok"} />
              <Stat label="Fails safely" value={`${(t.failsSafelyRate * 100).toFixed(0)}%`} icon={Layers} tone={t.failsSafelyRate >= 1 ? "ok" : "warn"} />
            </MetricGroup>
            <MetricGroup label="Cost & tooling">
              <Stat label="Cheapest pass" value={`$${t.cheapestPassUsd.toFixed(4)}`} icon={DollarSign} tone="accent" />
              <Stat label="Tool calls" value={String(t.totalToolCalls)} icon={Wrench} />
              <Stat label="Cases" value={String(t.perCase.length)} icon={Activity} />
            </MetricGroup>
          </section>

          <section className="card p-5 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <Gauge className="size-4 text-accent-soft" /> Telemetry integrity
                </h2>
                <p className="mt-1 text-xs text-fg-muted">
                  Throughput is output tokens divided by measured runner wall-clock seconds. Tool timing is only shown as complete when each streamed tool call has a matching result event.
                </p>
              </div>
              <span className={clsx(
                "rounded border px-2 py-1 text-xs mono",
                t.quality.warnings.length ? "border-warn/30 bg-warn/10 text-warn" : "border-ok/30 bg-ok/10 text-ok"
              )}>
                {t.quality.warnings.length ? "review" : "measured"}
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <IntegrityStat label="Duration" value={`${t.quality.measuredDurationCases}/${t.quality.completedCases}`} detail="runner wall-clock" ok={t.quality.measuredDurationCases === t.quality.completedCases} />
              <IntegrityStat label="Usage" value={`${t.quality.usageReportedCases}/${t.quality.completedCases}`} detail="CLI usage payload" ok={t.quality.usageReportedCases === t.quality.completedCases} />
              <IntegrityStat label="Tool events" value={`${t.quality.toolEventCases}/${t.quality.completedCases}`} detail="streamed calls" ok={t.quality.toolEventCases === t.quality.completedCases} />
              <IntegrityStat label="Tool timing" value={`${Math.round(t.quality.toolDurationCoverage * 100)}%`} detail="matched result durations" ok={t.quality.toolDurationCoverage >= 0.95} />
            </div>
            {t.quality.warnings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.quality.warnings.map((warning) => (
                  <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                    {warning}
                  </span>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <ScatterSection cases={cases} maxTokens={maxTokens} maxCost={maxCost} />
            <TokPerSecSection cases={cases} maxTokPerSec={maxTokPerSec} />
          </div>

          <section className="card p-5 mb-4">
            <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
              <Wrench className="size-4 text-fg-muted" /> Tool usage
            </h2>
            <div className="space-y-2">
              {t.topTools.length === 0 && <div className="text-sm text-fg-muted">No tool calls recorded.</div>}
              {t.topTools.map((tool) => {
                const pct = t.totalToolCalls > 0 ? (tool.count / t.totalToolCalls) * 100 : 0;
                return (
                  <div key={tool.name} className="flex items-center gap-3">
                    <span className="text-xs mono w-40 shrink-0 text-fg-muted">{tool.name}</span>
                    <div className="flex-1 h-4 bg-bg-elev rounded overflow-hidden">
                      <div className="h-full bg-accent/60 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs mono w-16 text-right">{tool.count}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-bd-subtle text-sm font-medium">Per-case breakdown</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium"><SortBtn label="Case" k="caseName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="tok/s" k="tokPerSec" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="in tok/s" k="inTokPerSec" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="tokens" k="tokensPerCase" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="cost" k="costPerCase" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="dur" k="durationMs" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="tools" k="toolCallCount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="tool ms" k="msPerTool" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-left px-4 py-2 font-medium">source</th>
                    <th className="text-right px-4 py-2 font-medium"><SortBtn label="turns" k="numTurns" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th className="text-left px-4 py-2 font-medium"><SortBtn label="status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {cases.map((c) => (
                    <tr key={c.caseId} className={clsx("hover:bg-bg-elev", c.status === "failed" && "bg-err/5", c.status === "error" && "bg-warn/5")}>
                      <td className="px-4 py-2">
                        <Link href={`/runs/${runId}/case/${c.caseId}`} className="hover:text-accent-soft">
                          {c.caseName}
                        </Link>
                        <div className="text-[10px] text-fg-dim mono">{c.model || "—"}</div>
                      </td>
                      <td className="px-4 py-2 text-right mono">{c.tokPerSec.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right mono text-fg-muted">{c.inTokPerSec.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right mono">{c.tokensPerCase.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right mono">${c.costPerCase.toFixed(4)}</td>
                      <td className="px-4 py-2 text-right mono">{fmtMs(c.durationMs)}</td>
                      <td className="px-4 py-2 text-right mono">{c.toolCallCount}</td>
                      <td className="px-4 py-2 text-right mono">{c.msPerTool ? fmtMs(c.msPerTool) : "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          <SourceChip label="dur" ok={c.durationSource === "runner_wall"} />
                          <SourceChip label="tok" ok={c.tokenSource === "cli_usage"} />
                          <SourceChip label="tool" ok={c.toolSource === "stream_tool_events"} />
                        </div>
                        {c.warnings.length > 0 && <div className="mt-1 text-[10px] text-warn">{c.warnings[0]}</div>}
                      </td>
                      <td className="px-4 py-2 text-right mono">{c.numTurns}</td>
                      <td className="px-4 py-2">
                        <span className={clsx(
                          "text-[10px] px-1.5 py-0.5 rounded mono",
                          c.status === "passed" ? "bg-ok/10 text-ok" :
                          c.status === "failed" ? "bg-err/10 text-err" :
                          c.status === "error" ? "bg-err/10 text-err" :
                          "bg-bg-elev text-fg-muted"
                        )}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function IntegrityStat({ label, value, detail, ok }: { label: string; value: string; detail: string; ok: boolean }) {
  return (
    <div className="rounded border border-bd-subtle bg-bg/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={clsx("mt-1 mono text-base font-semibold", ok ? "text-ok" : "text-warn")}>{value}</div>
      <div className="mt-0.5 text-[10px] text-fg-dim">{detail}</div>
    </div>
  );
}

function SourceChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={clsx(
      "rounded border px-1.5 py-0.5 text-[10px] mono",
      ok ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
    )}>
      {label}
    </span>
  );
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function MetricGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "ok" | "warn" | "err" | "accent" }) {
  const c = tone === "ok" ? "text-ok" : tone === "err" ? "text-err" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent-soft" : "text-fg";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={`text-base font-semibold mono tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

function ScatterSection({ cases, maxTokens, maxCost }: { cases: PerCase[]; maxTokens: number; maxCost: number }) {
  const W = 460, H = 240, P = 36;
  const ix = (v: number) => P + (v / maxTokens) * (W - P - 12);
  const iy = (v: number) => H - P - (v / maxCost) * (H - P - 12);
  return (
    <section className="card p-5">
      <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Cpu className="size-4 text-fg-muted" /> Tokens vs cost
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P} y1={iy(maxCost * f)} x2={W - 8} y2={iy(maxCost * f)} stroke="#1d1d22" strokeWidth={1} />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={`v${f}`} x1={ix(maxTokens * f)} y1={P} x2={ix(maxTokens * f)} y2={H - P} stroke="#1d1d22" strokeWidth={1} />
        ))}
        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-fg-dim" style={{ fontSize: 9 }}>tokens</text>
        <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-fg-dim" style={{ fontSize: 9 }}>cost $</text>
        {cases.map((c) => (
          <circle
            key={c.caseId}
            cx={ix(c.tokensPerCase)}
            cy={iy(c.costPerCase)}
            r={4}
            fill={c.status === "passed" ? "#3fb950" : c.status === "error" ? "#d29922" : "#f85149"}
            stroke={c.status === "passed" ? "#3fb950" : c.status === "error" ? "#d29922" : "#f85149"}
            strokeWidth={1.5}
            fillOpacity={0.5}
            className="cursor-pointer transition-all hover:opacity-100"
            style={{ transitionProperty: "fill-opacity, r" }}
          >
            <title>{`${c.caseName}\n${c.tokensPerCase} tok · $${c.costPerCase.toFixed(4)} · ${c.status}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-fg-muted">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-ok" /> passed</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-err" /> failed</span>
      </div>
    </section>
  );
}

function TokPerSecSection({ cases, maxTokPerSec }: { cases: PerCase[]; maxTokPerSec: number }) {
  const W = 460, H = 240, P = 36;
  const barW = Math.max(4, (W - P - 8) / Math.max(cases.length, 1) - 4);
  const by = (v: number) => H - P - (v / maxTokPerSec) * (H - P - 12);
  return (
    <section className="card p-5">
      <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Gauge className="size-4 text-fg-muted" /> Output tok/s per case
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P} y1={by(maxTokPerSec * f)} x2={W - 8} y2={by(maxTokPerSec * f)} stroke="#1d1d22" strokeWidth={1} />
        ))}
        {cases.map((c, i) => {
          const x = P + i * (barW + 4);
          const h = (c.tokPerSec / maxTokPerSec) * (H - P - 12);
          return (
            <g key={c.caseId}>
              <rect x={x} y={H - P - h} width={barW} height={h}
                fill={c.status === "passed" ? "#3fb950" : c.status === "error" ? "#d29922" : "#f85149"}
                fillOpacity={0.6}
                rx={2}
                className="cursor-pointer transition-opacity hover:opacity-100"
              >
                <title>{`${c.caseName}: ${c.tokPerSec.toFixed(1)} tok/s · ${c.status}`}</title>
              </rect>
            </g>
          );
        })}
        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-fg-dim" style={{ fontSize: 9 }}>cases</text>
        <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-fg-dim" style={{ fontSize: 9 }}>tok/s</text>
      </svg>
    </section>
  );
}

function SortBtn({
  label, k, sortKey, sortDir, onClick, align = "right",
}: {
  label: string; k: keyof PerCase; sortKey: keyof PerCase; sortDir: "asc" | "desc";
  onClick: (k: keyof PerCase) => void; align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onClick(k)}
      className={clsx("inline-flex items-center gap-1 hover:text-fg transition-colors", active && "text-accent-soft")}
    >
      {align === "left" && label}
      {active && (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />)}
      {align === "right" && label}
    </button>
  );
}
