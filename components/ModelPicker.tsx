"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Cpu, Loader2, Search } from "lucide-react";
import type { ModelInfo } from "@/lib/models";

interface Props {
  value?: string;
  onChange: (model: string | undefined) => void;
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

export default function ModelPicker({ value, onChange }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .finally(() => setLoading(false));
  }, []);

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
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm bg-bg border border-bd rounded-md hover:bg-bg-elev focus:outline-none focus:border-accent"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Cpu className="size-4 text-fg-muted shrink-0" />
          {loading ? <Loader2 className="size-3.5 animate-spin text-fg-dim" /> : null}
          <span className={clsx("truncate", usingDefault && "text-fg-muted")}>
            {selected ? selected.label : value || "Default (ncode auto)"}
          </span>
          {selected && (
            <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev shrink-0">{selected.family}</span>
          )}
        </span>
        <ChevronDown className="size-3.5 text-fg-dim shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-bg-subtle border border-bd rounded-md shadow-xl max-h-80 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-bd-subtle">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg border border-bd-subtle">
                <Search className="size-3 text-fg-dim" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-fg-dim"
                />
              </div>
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
                  <div className="text-sm">Default</div>
                  <div className="text-[10px] text-fg-dim">Let ncode pick the model</div>
                </div>
                {usingDefault && <Check className="size-3.5 text-accent-soft" />}
              </button>
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onChange(m.id); setOpen(false); }}
                  className={clsx(
                    "w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-bg-elev text-left",
                    value === m.id && "bg-accent/10"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{m.label}</div>
                    <div className="text-[10px] text-fg-dim mono truncate">{m.id}</div>
                  </div>
                  <span
                    className="text-[9px] uppercase tracking-wider mono px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: FAMILY_COLORS[m.family] || "#5a5a63", backgroundColor: (FAMILY_COLORS[m.family] || "#5a5a63") + "20" }}
                  >
                    {m.family}
                  </span>
                  {value === m.id && <Check className="size-3.5 text-accent-soft shrink-0" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-fg-muted">No models found.</div>
              )}
            </div>
            <div className="p-2 border-t border-bd-subtle">
              <input
                value={value || ""}
                onChange={(e) => onChange(e.target.value || undefined)}
                placeholder="Custom model id…"
                className="w-full px-2 py-1.5 text-xs bg-bg border border-bd-subtle rounded mono focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}