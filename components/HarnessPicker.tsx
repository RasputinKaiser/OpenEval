"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Loader2, Search, Terminal, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import type { DiscoveredHarness } from "@/lib/adapters/discover";

interface Props {
  value?: string;
  onChange: (harness: string | undefined) => void;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  available: { label: "installed", cls: "bg-ok/10 text-ok" },
  not_found: { label: "missing", cls: "bg-fg-dim/10 text-fg-dim" },
  error: { label: "error", cls: "bg-err/10 text-err" },
};

export default function HarnessPicker({ value, onChange }: Props) {
  const [harnesses, setHarnesses] = useState<DiscoveredHarness[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  function load(refresh = false) {
    setLoading(true);
    fetch(`/api/harnesses${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((d) => setHarnesses(d.harnesses || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(false); }, []);

  const filtered = harnesses.filter((h) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return h.id.toLowerCase().includes(q) || h.label.toLowerCase().includes(q);
  });

  const selected = harnesses.find((h) => h.id === value);
  const usingDefault = !value;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm bg-bg border border-bd rounded-md hover:bg-bg-elev focus:outline-none focus:border-accent"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Terminal className="size-4 text-fg-muted shrink-0" />
          {loading ? <Loader2 className="size-3.5 animate-spin text-fg-dim" /> : null}
          <span className={clsx("truncate", usingDefault && "text-fg-muted")}>
            {selected ? selected.label : value || "Default (ncode)"}
          </span>
          {selected?.version && (
            <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev shrink-0">{selected.version}</span>
          )}
          {selected && STATUS_BADGE[selected.status] && (
            <span className={clsx("text-[9px] uppercase tracking-wider mono px-1.5 py-0.5 rounded shrink-0", STATUS_BADGE[selected.status].cls)}>
              {STATUS_BADGE[selected.status].label}
            </span>
          )}
        </span>
        <ChevronDown className="size-3.5 text-fg-dim shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-bg-subtle border border-bd rounded-md shadow-xl max-h-96 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-bd-subtle flex items-center gap-2">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg border border-bd-subtle flex-1">
                <Search className="size-3 text-fg-dim" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search harnesses…"
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-fg-dim"
                />
              </div>
              <button
                type="button"
                title="Re-probe PATH"
                onClick={() => load(true)}
                className="p-1.5 rounded-md hover:bg-bg-elev text-fg-muted"
              >
                <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <button
                onClick={() => { onChange(undefined); setOpen(false); }}
                className={clsx(
                  "w-full flex items-center justify-between px-3 py-2 hover:bg-bg-elev text-left",
                  usingDefault && "bg-accent/10"
                )}
              >
                <div>
                  <div className="text-sm">Default (ncode)</div>
                  <div className="text-[10px] text-fg-dim">Use the default harness adapter</div>
                </div>
                {usingDefault && <Check className="size-3.5 text-accent-soft" />}
              </button>
              {filtered.map((h) => {
                const disabled = h.status === "not_found";
                const badge = STATUS_BADGE[h.status];
                return (
                  <button
                    key={h.id}
                    disabled={disabled}
                    onClick={() => { if (!disabled) { onChange(h.id); setOpen(false); } }}
                    className={clsx(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 text-left",
                      disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-bg-elev",
                      value === h.id && "bg-accent/10"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate flex items-center gap-1.5">
                        {h.status === "available" ? <CheckCircle2 className="size-3 text-ok shrink-0" /> : null}
                        {h.status === "error" ? <AlertCircle className="size-3 text-err shrink-0" /> : null}
                        {h.label}
                      </div>
                      <div className="text-[10px] text-fg-dim mono truncate">
                        {h.id} · {h.bin || "not on PATH"}
                        {h.version ? ` · ${h.version}` : ""}
                      </div>
                      {disabled && h.detail && <div className="text-[10px] text-fg-dim mt-0.5">{h.detail}</div>}
                    </div>
                    {badge && (
                      <span className={clsx("text-[9px] uppercase tracking-wider mono px-1.5 py-0.5 rounded shrink-0", badge.cls)}>
                        {badge.label}
                      </span>
                    )}
                    {value === h.id && <Check className="size-3.5 text-accent-soft shrink-0" />}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-fg-muted">No harnesses found.</div>
              )}
            </div>
            <div className="p-2 border-t border-bd-subtle">
              <input
                value={value || ""}
                onChange={(e) => onChange(e.target.value || undefined)}
                placeholder="Custom harness id…"
                className="w-full px-2 py-1.5 text-xs bg-bg border border-bd-subtle rounded mono focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
