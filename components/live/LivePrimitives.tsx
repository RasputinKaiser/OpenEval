"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertCircle, AlertTriangle, Gauge, Inbox, RefreshCw } from "lucide-react";
import { redactSensitiveText } from "@/lib/redaction";
import type { LiveSession, MetricSource } from "@/lib/live";
import { displayText, isSessionStale } from "./live-shared";

export function TinyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-fg-muted truncate">{label}</span>
      <span className="mono text-xs font-semibold tabular-nums text-fg">{value}</span>
    </div>
  );
}

export function MetricGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      {children}
    </div>
  );
}

export function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" | "warn" | "ok" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("mono text-base font-semibold tabular-nums", tone === "err" && "text-err", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
    </div>
  );
}

export function ListStack({ items, redact, users, empty }: { items: Array<{ key: string; label: string; value?: string }>; redact: boolean; users: ReadonlySet<string>; empty: string }) {
  if (items.length === 0) return <div className="text-sm text-fg-muted">{empty}</div>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 items-center justify-between gap-3 text-xs">
          <span className="truncate text-fg-muted">{displayText(item.label, redact, users)}</span>
          {item.value ? <span className="mono shrink-0 text-[10px] text-fg-dim">{item.value}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function SourceChip({ label, source }: { label: string; source: MetricSource }) {
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

export function QualityBadge({ value }: { value: number }) {
  return (
    <span className={clsx(
      "inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-[11px] mono",
      value >= 80 ? "bg-ok/10 text-ok" : value >= 55 ? "bg-warn/10 text-warn" : "bg-err/10 text-err"
    )}>
      <Gauge className="size-3" /> {Math.round(value)}%
    </span>
  );
}

export function StatusPill({ session, stale: staleProp }: { session: LiveSession; stale?: boolean }) {
  const stale = staleProp ?? isSessionStale(session);
  if (session.isError || session.toolErrors > 0 || session.hookErrors > 0) {
    return <span className="w-fit rounded bg-err/10 px-2 py-1 text-[10px] mono text-err">error</span>;
  }
  if (stale) return <span className="w-fit rounded bg-warn/10 px-2 py-1 text-[10px] mono text-warn">stale</span>;
  return <span className="w-fit rounded bg-ok/10 px-2 py-1 text-[10px] mono text-ok">ok</span>;
}

// Isolated ticker so the once-a-second re-render stays inside this tiny
// component instead of touching the session table. When `staleError` is set
// the last poll failed: the dot turns amber and the label says the data on
// screen is from the last successful poll instead of silently looking fresh.
export function UpdatedIndicator({ updatedAt, staleError }: { updatedAt: number | null; staleError?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (updatedAt == null) return null;
  const seconds = now == null ? 0 : Math.max(0, Math.floor((now - updatedAt) / 1000));
  const age = seconds < 120 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  if (staleError) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] tabular-nums text-warn"
        title={`Live poll failing: ${redactSensitiveText(staleError)} — showing last good data`}
      >
        <AlertTriangle className="size-3" aria-hidden />
        stale · last update {age} ago
      </span>
    );
  }
  const label = seconds < 1 ? "updated just now" : seconds < 120 ? `updated ${seconds}s ago` : `updated ${Math.floor(seconds / 60)}m ago`;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 px-1 text-[10px] tabular-nums text-fg-dim"
      title="Time since the last successful live poll"
    >
      <span className="size-1.5 rounded-full bg-ok/60" aria-hidden />
      {label}
    </span>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <header className="mb-6">
        <div className="mb-2 h-8 w-64 shimmer rounded" />
        <div className="h-4 w-96 shimmer rounded" />
      </header>
      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
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
      <LoadingSkeletonRows />
    </div>
  );
}

export function LoadingSkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-bd bg-bg-subtle">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
          <div className="h-4 w-4 shimmer rounded" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 shimmer rounded" />
            <div className="h-3 w-1/2 shimmer rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyCard({ warnings }: { warnings: string[] }) {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="card flex flex-col items-center p-8 text-center">
        <Inbox className="mb-4 size-10 text-fg-muted" />
        <h2 className="mb-2 text-lg font-medium">No live sessions found yet</h2>
        <p className="max-w-md text-sm text-fg-muted">
          Sessions will appear here as the selected harness&apos;s live-trace directory accumulates{" "}
          <code className="mono text-xs">.jsonl</code> traces.
        </p>
        {warnings.length > 0 && (
          <div className="mt-4 rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">{warnings.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
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
