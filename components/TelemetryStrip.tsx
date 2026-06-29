"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Gauge, Timer, Layers, AlertTriangle, Hash, Wrench, BarChart3, DollarSign, Bug, Shield, ShieldCheck, Activity } from "lucide-react";
import type { RunTelemetry } from "@/lib/types";

export default function TelemetryStrip({ runId }: { runId: string }) {
  const [t, setT] = useState<RunTelemetry | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/runs/${runId}/telemetry`).then((r) => r.json());
        if (!cancelled) setT(r.telemetry);
      } catch {}
      if (!cancelled) timer = setTimeout(poll, 2500);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId]);

  if (!t) return null;

  return (
    <div className="card p-3 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
            <Gauge className="size-3" /> Live telemetry
          </span>
          <span className={clsx(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
            t.quality.warnings.length ? "border-warn/30 bg-warn/10 text-warn" : "border-ok/30 bg-ok/10 text-ok"
          )}>
            <Activity className="size-3" />
            {t.quality.warnings.length ? "review telemetry" : "measured"}
          </span>
        </div>
        <Link href={`/runs/${runId}/bench`} className="text-[11px] text-accent-soft hover:underline flex items-center gap-1">
          <BarChart3 className="size-3" /> Full bench
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricGroup label="Throughput">
          <Cell label="avg tok/s" value={t.avgTokPerSec.toFixed(1)} icon={Gauge} />
          <Cell label="max tok/s" value={t.maxTokPerSec.toFixed(1)} icon={Gauge} />
          <Cell label="cache hit" value={`${(t.cacheHitRate * 100).toFixed(0)}%`} icon={Layers} />
        </MetricGroup>
        <MetricGroup label="Latency">
          <Cell label="p50" value={fmtMs(t.p50DurationMs)} icon={Timer} />
          <Cell label="p95" value={fmtMs(t.p95DurationMs)} icon={Timer} />
          <Cell label="avg turns" value={t.avgTurns.toFixed(1)} icon={Hash} />
        </MetricGroup>
        <MetricGroup label="Safety">
          <Cell label="err rate" value={`${(t.errorRate * 100).toFixed(0)}%`} icon={AlertTriangle} tone={t.errorRate > 0 ? "warn" : undefined} />
          <Cell label="forbidden" value={`${(t.forbiddenViolationRate * 100).toFixed(0)}%`} icon={Bug} tone={t.forbiddenViolationRate > 0 ? "warn" : undefined} />
          <Cell label="safe-fail" value={`${(t.failsSafelyRate * 100).toFixed(0)}%`} icon={t.failsSafelyRate >= 0.9 ? ShieldCheck : Shield} tone={t.failsSafelyRate >= 0.9 ? "ok" : undefined} />
        </MetricGroup>
        <MetricGroup label="Cost & mix">
          <Cell label="cheapest pass" value={`$${t.cheapestPassUsd.toFixed(4)}`} icon={DollarSign} />
          <Cell label="tool calls" value={String(t.totalToolCalls)} icon={Wrench} />
          <Cell label="top tool" value={t.topTools[0]?.name ?? "—"} icon={Wrench} small />
        </MetricGroup>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <QualityCell
          label="duration source"
          value={`${t.quality.measuredDurationCases}/${t.quality.completedCases}`}
          detail="runner wall-clock cases"
          ok={t.quality.measuredDurationCases === t.quality.completedCases}
        />
        <QualityCell
          label="usage source"
          value={`${t.quality.usageReportedCases}/${t.quality.completedCases}`}
          detail="CLI usage records"
          ok={t.quality.usageReportedCases === t.quality.completedCases}
        />
        <QualityCell
          label="tool timing"
          value={`${Math.round(t.quality.toolDurationCoverage * 100)}%`}
          detail="calls with measured duration"
          ok={t.quality.toolDurationCoverage >= 0.95}
        />
      </div>
      {t.quality.warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {t.quality.warnings.map((warning) => (
            <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] text-warn">
              {warning}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QualityCell({ label, value, detail, ok }: { label: string; value: string; detail: string; ok: boolean }) {
  return (
    <div className="rounded bg-bg-elev/35 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
        <span className={clsx("mono text-xs", ok ? "text-ok" : "text-warn")}>{value}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-fg-dim">{detail}</div>
    </div>
  );
}

function MetricGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim px-1">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Cell({
  label, value, icon: Icon, small, tone,
}: {
  label: string; value: string; icon: any; small?: boolean; tone?: "warn" | "ok";
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-bg-elev/50">
      <div className="flex items-center gap-1.5 text-[10px] text-fg-muted">
        <Icon className="size-2.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={clsx("mono tabular-nums font-medium text-xs", small ? "max-w-[80px] truncate" : "", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}
