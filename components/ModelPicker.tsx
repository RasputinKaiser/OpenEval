"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Cpu, EyeOff, Image as ImageIcon, Loader2, RefreshCw, Search } from "lucide-react";
import type { ModelInfo } from "@/lib/models";
import { cachedFetch, invalidateCache } from "@/lib/cached-fetch";

interface Props {
  id?: string;
  label?: string;
  value?: string;
  onChange: (model: string | undefined) => void;
  /** Restrict the model list to this harness's descriptor-declared models. */
  harness?: string;
}

const FAMILY_COLORS: Record<string, string> = {
  opus: "#a78bff",
  sonnet: "#7c5cff",
  haiku: "#56d4dd",
  glm: "#3fb950",
  deepseek: "#d29922",
  openai: "#10a37f",
  gemini: "#4285f4",
  llama: "#0866ff",
  qwen: "#f85149",
  auto: "#8b8b94",
  other: "#5a5a63",
};

export default function ModelPicker({ id, label, value, onChange, harness }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const url = `/api/models${harness ? `?harness=${encodeURIComponent(harness)}` : ""}`;
    setLoading(true);
    setError(null);
    cachedFetch<{ models: ModelInfo[] }>(url)
      .then((d) => { if (id === requestId.current) setModels(d.models || []); })
      .catch(() => { if (id === requestId.current) { setModels([]); setError("Model discovery failed. Retry or enter a custom model id."); } })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [harness, retry]);

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

  const filtered = models.filter((m) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || m.family.toLowerCase().includes(q);
  });

  const selected = models.find((m) => m.id === value);
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
        aria-controls={open ? `${id ?? "model-picker"}-listbox` : undefined}
        className="min-h-11 w-full flex items-center justify-between gap-2 rounded-md border border-bd bg-bg px-3 py-2 text-sm outline-none hover:bg-bg-elev focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Cpu className="size-4 text-fg-muted shrink-0" />
          {loading ? <Loader2 className="size-3.5 animate-spin text-fg-dim" /> : null}
          <span className={clsx("truncate", usingDefault && "text-fg-muted")}>
            {selected ? selected.label : value || "Default (harness auto)"}
          </span>
          {selected && (
            <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev shrink-0">{selected.family}</span>
          )}
          {selected?.capabilities.visualCodeOutput === true && <ImageIcon className="size-3 text-ok shrink-0" />}
          {selected?.capabilities.visionInput === false && <EyeOff className="size-3 text-fg-dim shrink-0" />}
        </span>
        <ChevronDown className="size-3.5 text-fg-dim shrink-0" />
      </button>

      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            id={`${id ?? "model-picker"}-listbox`}
            role="listbox"
            aria-label={label ? `${label} options` : "Model options"}
            className="absolute z-20 mt-1 w-full bg-bg-subtle border border-bd rounded-md shadow-xl max-h-80 overflow-hidden flex flex-col origin-top"
            style={{ animation: "menu-enter 120ms cubic-bezier(0.2, 0, 0, 1)" }}
          >
            <div className="p-2 border-b border-bd-subtle">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg border border-bd-subtle">
                <Search className="size-3 text-fg-dim" />
                <input
                  aria-label="Search models"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="min-h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
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
                  <div className="text-sm">Default</div>
                  <div className="text-[10px] text-fg-dim">Let the harness pick the model</div>
                </div>
                {usingDefault && <Check className="size-3.5 text-accent-soft" />}
              </button>
              {filtered.map((m) => (
                <button
                  key={m.id}
                  role="option"
                  aria-selected={value === m.id}
                  onClick={() => { onChange(m.id); setOpen(false); }}
                  className={clsx(
                    "min-h-10 w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    value === m.id && "bg-accent/10"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{m.label}</div>
                    <div className="text-[10px] text-fg-dim mono truncate">{m.id}</div>
                  </div>
                  <span
                    className="text-[9px] uppercase tracking-[0.12em] mono px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: FAMILY_COLORS[m.family] || "#5a5a63", backgroundColor: (FAMILY_COLORS[m.family] || "#5a5a63") + "20" }}
                  >
                    {m.family}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.12em] mono px-1.5 py-0.5 rounded shrink-0 bg-bg-elev text-fg-dim">
                    {m.capabilities.visionInput === true ? "vision" : m.capabilities.visionInput === false ? "no vision" : "vision ?"}
                  </span>
                  {m.capabilities.visualCodeOutput && (
                    <span className="text-[9px] uppercase tracking-[0.12em] mono px-1.5 py-0.5 rounded shrink-0 bg-ok/10 text-ok">
                      visual code
                    </span>
                  )}
                  {value === m.id && <Check className="size-3.5 text-accent-soft shrink-0" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-fg-muted">No models found.</div>
              )}
            </div>
            <div className="p-2 border-t border-bd-subtle">
              <input
                aria-label="Custom model id"
                value={value || ""}
                onChange={(e) => onChange(e.target.value || undefined)}
                placeholder="Custom model id…"
              className="min-h-10 w-full rounded border border-bd-subtle bg-bg px-2 py-1.5 text-xs mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            {error && (
              <div role="alert" className="flex items-center justify-between gap-2 border-t border-bd-subtle px-3 py-2 text-[10px] text-err">
                <span>{error}</span>
                <button
                  type="button"
                  aria-label="Retry model discovery"
                  title="Retry model discovery"
                  onClick={() => { invalidateCache(urlForModels(harness)); setRetry((value) => value + 1); }}
                  className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md hover:bg-bg-elev"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {error && !open && <div role="alert" className="mt-1.5 text-[10px] leading-4 text-err">{error}</div>}
    </div>
  );
}

function urlForModels(harness?: string): string {
  return `/api/models${harness ? `?harness=${encodeURIComponent(harness)}` : ""}`;
}
