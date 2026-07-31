"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Loader2, Search, Terminal, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import type { DiscoveredHarness } from "@/lib/adapters/discover";
import { describeHarnessFailure } from "@/lib/adapters/diagnostics";
import { cachedFetch, invalidateCache } from "@/lib/cached-fetch";

interface Props {
  id?: string;
  label?: string;
  value?: string;
  onChange: (harness: string | undefined) => void;
  /** Fires on every successful discovery load (initial and re-probe) so the
   *  parent can validate against the same data the picker shows, instead of
   *  holding its own copy that goes stale after a re-probe. */
  onDiscovered?: (data: { harnesses: DiscoveredHarness[]; defaultHarness: string }) => void;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  available: { label: "installed", cls: "bg-ok/10 text-ok" },
  not_found: { label: "missing", cls: "bg-fg-dim/10 text-fg-dim" },
  error: { label: "error", cls: "bg-err/10 text-err" },
};

export default function HarnessPicker({ id, label, value, onChange, onDiscovered }: Props) {
  const [harnesses, setHarnesses] = useState<DiscoveredHarness[]>([]);
  const [defaultHarness, setDefaultHarness] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  function load(refresh = false) {
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    const url = `/api/harnesses${refresh ? "?refresh=1" : ""}`;
    if (refresh) invalidateCache(url);
    cachedFetch<{ harnesses: DiscoveredHarness[]; defaultHarness?: string }>(url)
      .then((d) => {
        if (request !== requestId.current) return;
        setHarnesses(d.harnesses || []);
        setDefaultHarness(d.defaultHarness || "");
        onDiscovered?.({ harnesses: d.harnesses || [], defaultHarness: d.defaultHarness || "" });
      })
      .catch(() => {
        if (request !== requestId.current) return;
        setHarnesses([]);
        setDefaultHarness("");
        setError("Harness discovery failed. Refresh the probe before launching a run.");
        // The parent must not treat an unresolved discovery request as a safe
        // default. An empty successful-shaped result makes that state explicit
        // and keeps the Start button blocked until a retry succeeds.
        onDiscovered?.({ harnesses: [], defaultHarness: "" });
      })
      .finally(() => { if (request === requestId.current) setLoading(false); });
  }

  // Mount-only initial probe; re-probe is user-driven via the refresh button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, []);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

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
        id={id}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id ?? "harness-picker"}-listbox` : undefined}
        className="min-h-11 w-full flex items-center justify-between gap-2 rounded-md border border-bd bg-bg px-3 py-2 text-sm outline-none hover:bg-bg-elev focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Terminal className="size-4 text-fg-muted shrink-0" />
          {loading ? <Loader2 className="size-3.5 animate-spin text-fg-dim" /> : null}
          <span className={clsx("truncate", usingDefault && "text-fg-muted")}>
            {selected ? selected.label : value || `Default${defaultHarness ? ` (${defaultHarness})` : ""}`}
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
          <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div id={`${id ?? "harness-picker"}-listbox`} role="listbox" aria-label={label ? `${label} options` : "Harness options"} className="absolute z-20 mt-1 w-full bg-bg-subtle border border-bd rounded-md shadow-xl max-h-96 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-bd-subtle flex items-center gap-2">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg border border-bd-subtle flex-1">
                <Search className="size-3 text-fg-dim" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search harnesses…"
                  className="min-h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <button
                type="button"
                aria-label="Refresh harness discovery"
                title="Re-probe PATH"
                onClick={() => load(true)}
                className="min-h-10 min-w-10 flex items-center justify-center rounded-md hover:bg-bg-elev text-fg-muted"
              >
                <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <button
                role="option"
                aria-selected={usingDefault}
                onClick={() => { onChange(undefined); setOpen(false); }}
                className={clsx(
                      "min-h-10 w-full flex items-center justify-between px-3 py-2 text-left hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                  usingDefault && "bg-accent/10"
                )}
              >
                <div>
                  <div className="text-sm">Default{defaultHarness ? ` (${defaultHarness})` : ""}</div>
                  <div className="text-[10px] text-fg-dim">Use the default harness adapter</div>
                </div>
                {usingDefault && <Check className="size-3.5 text-accent-soft" />}
              </button>
              {filtered.map((h) => {
                const disabled = h.status === "not_found";
                const badge = STATUS_BADGE[h.status];
                const diagnostic = h.status !== "available" ? describeHarnessFailure(h) : null;
                return (
                  <button
                    key={h.id}
                    role="option"
                    aria-selected={value === h.id}
                    disabled={disabled}
                    title={disabled ? (h.detail || "Binary not found on PATH — install it or set the env override.") : undefined}
                    onClick={() => { if (!disabled) { onChange(h.id); setOpen(false); } }}
                    className={clsx(
                      "min-h-10 w-full flex items-center justify-between gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
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
                      {diagnostic && (
                        <div className={clsx("text-[10px] mt-0.5", diagnostic.level === "error" ? "text-err" : "text-fg-dim")}>
                          {diagnostic.title}: {diagnostic.message}
                        </div>
                      )}
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
                aria-label="Custom harness id"
                value={value || ""}
                onChange={(e) => onChange(e.target.value || undefined)}
                placeholder="Custom harness id…"
                className="min-h-10 w-full rounded border border-bd-subtle bg-bg px-2 py-1.5 text-xs mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>
        </>
      )}
      {error && <div role="alert" className="mt-1.5 text-[10px] leading-4 text-err">{error}</div>}
    </div>
  );
}
