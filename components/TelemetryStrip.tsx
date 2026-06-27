"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gauge, Timer, Layers, AlertTriangle, Hash, Wrench, BarChart3 } from "lucide-react";
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
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
          <Gauge className="size-3" /> Live telemetry
        </span>
        <Link href={`/runs/${runId}/bench`} className="text-[11px] text-accent-soft hover:underline flex items-center gap-1">
          <BarChart3 className="size-3" /> Full bench
        </Link>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9 gap-2">
        <Cell label="avg tok/s" value={t.avgTokPerSec.toFixed(1)} icon={Gauge} />
        <Cell label="max tok/s" value={t.maxTokPerSec.toFixed(1)} icon={Gauge} />
        <Cell label="p50 dur" value={fmtMs(t.p50DurationMs)} icon={Timer} />
        <Cell label="p95 dur" value={fmtMs(t.p95DurationMs)} icon={Timer} />
        <Cell label="cache" value={`${(t.cacheHitRate * 100).toFixed(0)}%`} icon={Layers} />
        <Cell label="err rate" value={`${(t.errorRate * 100).toFixed(0)}%`} icon={AlertTriangle} />
        <Cell label="avg turns" value={t.avgTurns.toFixed(1)} icon={Hash} />
        <Cell label="tool calls" value={String(t.totalToolCalls)} icon={Wrench} />
        <Cell label="top tool" value={t.topTools[0]?.name ?? "—"} icon={Wrench} small />
      </div>
    </div>
  );
}

function Cell({ label, value, icon: Icon, small }: { label: string; value: string; icon: any; small?: boolean }) {
  return (
    <div className="px-2 py-1.5 rounded bg-bg-elev/50">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-2.5" /> {label}
      </div>
      <div className={`mono ${small ? "text-[11px] truncate" : "text-sm"} font-medium mt-0.5`}>{value}</div>
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