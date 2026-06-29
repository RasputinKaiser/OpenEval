"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Gauge, Wrench, Search, X } from "lucide-react";
import type { CaseDefinition } from "@/lib/types";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const CAT_ACCENT: Record<string, string> = {
  "agentic-swe": "bg-accent",
  "single-tool": "bg-ok",
  "reasoning": "bg-warn",
  "visual-code": "bg-blue-500",
};

export default function CasesClient({ cases, activeCategory }: { cases: CaseDefinition[]; activeCategory?: string }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);

  const grouped = useMemo(() => {
    const filtered = activeCategory ? cases.filter((c) => c.category === activeCategory) : cases;
    if (!debouncedQuery.trim()) {
      return filtered.reduce<Record<string, CaseDefinition[]>>((a, c) => { (a[c.category] ||= []).push(c); return a; }, {});
    }
    const q = debouncedQuery.toLowerCase();
    const matching = filtered.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.description?.toLowerCase().includes(q) ?? false) ||
      (c.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
    );
    return matching.reduce<Record<string, CaseDefinition[]>>((a, c) => { (a[c.category] ||= []).push(c); return a; }, {});
  }, [cases, debouncedQuery, activeCategory]);

  const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-fg-dim" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cases by name, id, tag…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-bg border border-bd rounded-md focus:outline-none focus:border-accent placeholder:text-fg-dim"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-h-8 min-w-8 flex items-center justify-center rounded text-fg-dim hover:text-fg"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-fg-dim mono">
          {total} case{total !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-8">
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat}>
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-sm font-medium uppercase tracking-wider text-fg-muted">{cat}</h2>
              <span className="text-[11px] text-fg-dim mono">{list.length}</span>
            </div>
            <div className="stagger-grid grid grid-cols-1 md:grid-cols-2 gap-2">
              {list.map((c) => (
                <Link
                  key={c.id}
                  href={`/runs/new?caseIds=${encodeURIComponent(c.id)}`}
                  className="relative overflow-hidden card p-4 pt-5 hover:bg-bg-elev active:scale-[0.96] transition-colors"
                >
                  <div className={clsx("absolute left-0 right-0 top-0 h-0.5", CAT_ACCENT[c.category] ?? "bg-accent")} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[10px] text-fg-dim mono mt-0.5">{c.id}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.difficulty && <span className="text-[10px] text-fg-muted mono px-1.5 py-0.5 rounded bg-bg-elev flex items-center gap-1"><Gauge className="size-2.5" /> {c.difficulty}</span>}
                      <span className="text-[10px] text-fg-muted mono px-1.5 py-0.5 rounded bg-bg-elev flex items-center gap-1">
                        <Wrench className="size-2.5" /> {c.graders.length}
                      </span>
                    </div>
                  </div>
                  {c.description && <p className="text-[11px] text-fg-muted mt-2 line-clamp-2">{c.description}</p>}
                  {c.tags && c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.map((t) => <span key={t} className="text-[10px] text-fg-dim mono">#{t}</span>)}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-[10px] text-fg-dim mono">
                    <span>turns {c.runner?.max_turns ?? 25}</span>
                    <span>timeout {c.runner?.timeout_seconds ?? 300}s</span>
                    {c.budget?.max_cost_usd != null && <span>budget ${c.budget.max_cost_usd.toFixed(2)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {total === 0 && (
        <div className="card p-12 text-center">
          <Search className="size-6 text-fg-dim mx-auto mb-2" />
          <div className="text-sm text-fg-muted">No cases match &ldquo;{query}&rdquo;.</div>
        </div>
      )}
    </>
  );
}