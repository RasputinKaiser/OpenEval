"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, Loader2, Plug, RefreshCw, Terminal, XCircle } from "lucide-react";
import type { DiscoveredHarness } from "@/lib/adapters/discover";
import { cachedFetch, invalidateCache } from "@/lib/cached-fetch";
import PageHeader from "./PageHeader";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  available: { label: "available", cls: "bg-ok/10 text-ok" },
  not_found: { label: "not found", cls: "bg-fg-dim/10 text-fg-dim" },
  error: { label: "error", cls: "bg-err/10 text-err" },
};

export default function HarnessesClient() {
  const [harnesses, setHarnesses] = useState<DiscoveredHarness[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function load(refresh = false) {
    setLoading(true);
    if (refresh) invalidateCache("/api/harnesses");
    const url = `/api/harnesses${refresh ? "?refresh=1" : ""}`;
    cachedFetch<{ harnesses: DiscoveredHarness[] }>(url)
      .then((d) => {
        setHarnesses(d.harnesses || []);
        if (!selected && (d.harnesses || []).length > 0) {
          const firstAvail = (d.harnesses as DiscoveredHarness[]).find((h) => h.status === "available");
          setSelected(firstAvail?.id ?? d.harnesses[0].id);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedFetch<{ harnesses: DiscoveredHarness[] }>("/api/harnesses")
      .then((d) => {
        if (cancelled) return;
        const list: DiscoveredHarness[] = d.harnesses || [];
        setHarnesses(list);
        setSelected((prev) => prev ?? list.find((h) => h.status === "available")?.id ?? list[0]?.id ?? null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function probe(id: string) {
    setProbing(id);
    try {
      const res = await fetch("/api/harnesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const updated: DiscoveredHarness = await res.json();
      setHarnesses((prev) => prev.map((h) => (h.id === id ? updated : h)));
    } finally {
      setProbing(null);
    }
  }

  const active = harnesses.find((h) => h.id === selected) ?? harnesses[0];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        icon={Plug}
        title="Harnesses"
        subtitle="Agent CLIs discovered on this machine. Pick one to inspect."
        actions={
          <button
            onClick={() => load(true)}
            className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors"
          >
            <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} /> Re-probe PATH
          </button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <div className="space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-3 py-2.5 rounded-md border border-bd space-y-2">
                <div className="flex items-center gap-2">
                  <div className="size-3.5 rounded-full shimmer" />
                  <div className="h-4 w-24 animate-pulse rounded bg-bd-subtle" />
                </div>
                <div className="h-3 w-32 animate-pulse rounded bg-bd-subtle" />
              </div>
            ))}
          </div>
          <div className="card p-5 space-y-4">
            <div className="h-6 w-40 animate-pulse rounded bg-bd-subtle" />
            <div className="h-3 w-32 animate-pulse rounded bg-bd-subtle" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-16 animate-pulse rounded bg-bd-subtle" />
                  <div className="h-4 w-24 animate-pulse rounded bg-bd-subtle" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <div className="space-y-1">
            {harnesses.map((h) => {
              const meta = STATUS_META[h.status];
              return (
                <button
                  key={h.id}
                  onClick={() => setSelected(h.id)}
                  className={clsx(
                    "w-full text-left px-3 py-2.5 rounded-md border transition-colors",
                    selected === h.id ? "border-accent bg-accent/10" : "border-bd hover:bg-bg-elev"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {h.status === "available" ? <CheckCircle2 className="size-3.5 text-ok shrink-0" />
                      : h.status === "error" ? <AlertCircle className="size-3.5 text-err shrink-0" />
                      : <Terminal className="size-3.5 text-fg-dim shrink-0" />}
                    <span className="text-sm truncate">{h.label}</span>
                  </div>
                  <div className="text-[10px] text-fg-dim mono mt-0.5 truncate">{h.id}{h.version ? ` · ${h.version}` : ""}</div>
                  {meta && <span className={clsx("inline-block mt-1 text-[9px] uppercase tracking-wider mono px-1.5 py-0.5 rounded", meta.cls)}>{meta.label}</span>}
                </button>
              );
            })}
          </div>

          {active && (
            <section className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{active.label}</h2>
                  <div className="text-[11px] text-fg-dim mono mt-0.5">{active.id}</div>
                </div>
                <button
                  onClick={() => probe(active.id)}
                  disabled={probing === active.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs rounded-md border border-bd hover:bg-bg-elev text-fg-muted disabled:opacity-50"
                >
                  <span className="icon-crossfade relative inline-flex size-3.5">
                    <RefreshCw className={clsx("absolute inset-0 size-3.5", probing === active.id && "opacity-0")} />
                    <Loader2 className={clsx("absolute inset-0 size-3.5 animate-spin", probing === active.id ? "opacity-100" : "opacity-0")} />
                  </span>
                  Probe
                </button>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm border-l-2 border-bd-subtle pl-4">
                <Field label="Status">
                  {(() => { const m = STATUS_META[active.status]; return m ? <span className={clsx("text-[10px] uppercase tracking-wider mono px-1.5 py-0.5 rounded", m.cls)}>{m.label}</span> : active.status; })()}
                </Field>
                <Field label="Resolved binary">{active.bin ?? "—"}</Field>
                <Field label="Version">{active.version ?? "—"}</Field>
                <Field label="Source">{active.source}</Field>
                <Field label="Output format">{active.capabilities.outputFormat}</Field>
                <Field label="Vision input">{capabilityLabel(active.capabilities.supportsVisionInput)}</Field>
              </dl>

              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1.5">Capabilities</div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={clsx("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mono", active.capabilities.reportsCost ? "bg-ok/10 text-ok" : "bg-bg-elev text-fg-dim")}>
                    {active.capabilities.reportsCost ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} cost
                  </span>
                  <span className={clsx("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mono", active.capabilities.reportsTokens ? "bg-ok/10 text-ok" : "bg-bg-elev text-fg-dim")}>
                    {active.capabilities.reportsTokens ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} tokens
                  </span>
                  <span className={clsx("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mono", active.capabilities.reportsTurns ? "bg-ok/10 text-ok" : "bg-bg-elev text-fg-dim")}>
                    {active.capabilities.reportsTurns ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} turns
                  </span>
                  <span className={clsx("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mono", capabilityClass(active.capabilities.supportsVisionInput))}>
                    {active.capabilities.supportsVisionInput === true ? <CheckCircle2 className="size-2.5" /> : active.capabilities.supportsVisionInput === false ? <XCircle className="size-2.5" /> : <span className="size-2.5 text-center">?</span>} vision {active.capabilities.supportsVisionInput === null ? "unknown" : ""}
                  </span>
                </div>
              </div>

              <div className="mt-3 text-[11px] mono text-fg-dim">
                Bin names: <span className="text-fg-muted">{active.binNames.join(", ")}</span>
              </div>

              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1.5">Sample command</div>
                <pre className="text-[11px] mono bg-bg border border-bd-subtle rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {active.sampleCommand ? `${active.sampleCommand.bin} ${active.sampleCommand.args.join(" ")}` : "—"}
                </pre>
              </div>

              {active.detail && (
                <div className="mt-3 text-xs text-err flex items-start gap-2">
                  <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                  <span>{active.detail}</span>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-bd-subtle text-[10px] text-fg-dim">
                Permission modes: {active.capabilities.permissionModes.length > 0 ? active.capabilities.permissionModes.join(", ") : "none declared"}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-0.5 mono text-sm break-all">{children}</dd>
    </div>
  );
}

function capabilityLabel(value: boolean | null): string {
  return value === true ? "yes" : value === false ? "no" : "unknown";
}

function capabilityClass(value: boolean | null): string {
  return value === true ? "bg-ok/10 text-ok" : value === false ? "bg-bg-elev text-fg-dim" : "bg-warn/10 text-warn";
}
