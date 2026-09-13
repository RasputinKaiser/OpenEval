"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaseComposition } from "./CaseComposition";
import Link from "next/link";
import clsx from "clsx";
import { Gauge, Wrench, Search, X, ChevronDown, ArrowRight, Play } from "lucide-react";
import type { CaseDefinition } from "@/lib/types";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const CAT_ACCENT: Record<string, string> = {
  "agentic-swe": "bg-accent",
  "single-tool": "bg-ok",
  "reasoning": "bg-warn",
  "visual-code": "bg-blue-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  "agentic-swe": "Agentic SWE",
  "single-tool": "Single tool",
  reasoning: "Reasoning",
  "visual-code": "Creative lab",
};

function visualKindLabel(kind: string): string {
  return ({
    svg: "SVG",
    threejs: "3D scene",
    web_ui: "HTML/CSS UI",
    app_ui: "App UI",
    screenshot: "Screenshot",
    canvas: "Canvas",
    data: "Data story",
    diagram: "Diagram",
    text: "Text / Markdown",
  } as Record<string, string>)[kind] ?? kind;
}

export default function CasesClient({ cases, activeCategory }: { cases: CaseDefinition[]; activeCategory?: string }) {
  const [query, setQuery] = useState("");
  useEffect(() => { const restore = () => setQuery(new URLSearchParams(window.location.search).get("q") ?? ""); restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, []);
  const changeQuery = (value: string) => { setQuery(value); const url = new URL(window.location.href); if (value) url.searchParams.set("q", value); else url.searchParams.delete("q"); window.history.replaceState(null, "", url); };
  const debouncedQuery = useDebouncedValue(query, 200);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);

  const grouped = useMemo(() => {
    const filtered = activeCategory ? cases.filter((c) => c.category === activeCategory) : cases;
    if (!debouncedQuery.trim()) {
      return filtered.reduce<Record<string, CaseDefinition[]>>((a, c) => { (a[c.category] ||= []).push(c); return a; }, {});
    }
    const q = debouncedQuery.trim().toLowerCase();
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
      <nav aria-label="Case categories" className="mb-4 flex flex-wrap gap-2">
        {[undefined, ...Array.from(new Set(cases.map(c => c.category)))].map(category => {
          const params = new URLSearchParams();
          if (category) params.set("category", category);
          if (query) params.set("q", query);
          return <Link key={category ?? "all"} href={`/cases${params.size ? `?${params}` : ""}`} aria-current={activeCategory === category ? "page" : undefined} className={clsx("analysis-control min-h-11", activeCategory === category && "text-accent-soft border-accent")}>
            {category ? CATEGORY_LABELS[category] ?? category : "All cases"} · {category ? cases.filter(c => c.category === category).length : cases.length}
          </Link>;
        })}
      </nav>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-0 basis-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-fg-dim" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            aria-label="Search cases"
            placeholder="Search cases by name, id, tag…"
            className="w-full min-h-11 pl-9 pr-14 py-2 text-sm bg-bg border border-bd rounded-md focus:outline-none focus:border-accent placeholder:text-fg-dim"
          />
          {query && (
            <button
              onClick={() => { changeQuery(""); searchRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center rounded text-fg-dim hover:text-fg"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-fg-dim mono" role="status">
          {total} case{total !== 1 ? "s" : ""}
        </span>
      </div>

      <CaseComposition cases={Object.values(grouped).flat()} />
      <div className="space-y-8">
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat}>
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-base font-semibold tracking-tight text-fg">{CATEGORY_LABELS[cat] ?? cat}</h2>
              <span className="text-xs text-fg-dim mono">{list.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map((c) => (
                <article
                  key={c.id}
                  className="case-library-card relative flex min-w-0 flex-col overflow-hidden card p-4 pt-5 sm:p-5"
                  aria-label={c.name}
                >
                  <div className={clsx("absolute left-0 right-0 top-0 h-0.5", CAT_ACCENT[c.category] ?? "bg-accent")} />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold leading-6 tracking-tight break-words">{c.name}</div>
                      <div className="text-xs text-fg-dim mono mt-0.5 break-all">{c.id}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.difficulty && <span className="text-xs text-fg-muted mono px-1.5 py-0.5 rounded bg-bg-elev flex items-center gap-1"><Gauge className="size-2.5" /> {c.difficulty}</span>}
                      <span className="text-xs text-fg-muted mono px-1.5 py-0.5 rounded bg-bg-elev flex items-center gap-1">
                        <Wrench className="size-2.5" /> {c.graders.length}
                      </span>
                    </div>
                  </div>
                  {c.description && <p className="text-sm leading-6 text-fg-muted mt-2 line-clamp-2">{c.description}</p>}
                  {c.benchmark?.intent && <p className="text-xs text-accent-soft mt-2 line-clamp-2">Measures: {c.benchmark.intent}</p>}
                  {(c.visual || c.benchmark?.deliverable) && (
                    <p className="text-xs text-fg-dim mt-2 line-clamp-2">
                      {c.visual && <>Output: {visualKindLabel(c.visual.kind)}</>}
                      {c.visual && c.benchmark?.deliverable && <span> · </span>}
                      {c.benchmark?.deliverable && <>Deliverable: {c.benchmark.deliverable}</>}
                    </p>
                  )}
                  {c.benchmark?.evidence && <p className="text-xs text-fg-dim mt-1">Evidence: {c.benchmark.evidence.join(" · ")}</p>}
                  {c.tags && c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.map((t) => <span key={t} className="text-xs text-fg-dim mono">#{t}</span>)}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-dim mono">
                    <span>turns {c.runner?.max_turns ?? 25}</span>
                    <span>time limit {c.runner?.timeout_seconds ?? 300}s</span>
                    {c.budget?.max_cost_usd != null && <span>configured budget ${c.budget.max_cost_usd.toFixed(2)}</span>}
                  </div>
                  <details className="case-contract mt-4 border-t border-bd pt-1">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded py-3 text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Task &amp; pass criteria<ChevronDown aria-hidden="true" className="case-contract-chevron size-4 shrink-0" /></summary>
                    <p className="mt-2 text-xs leading-5 text-fg-muted">To pass, successful checks must account for at least {((c.pass_threshold ?? 1) * 100).toLocaleString()}% of the total check weight. Any failed forbidden-content check prevents a pass. A grader infrastructure error cannot establish a pass.</p>
                    <p className="mt-2 text-xs leading-5 text-fg-muted">Weight controls how much each check contributes. The original task prompt is shown below.</p>
                    <ul className="my-3 space-y-1 text-xs text-fg-muted">
                      {c.graders.map((grader, index) => <li key={index} className="flex flex-wrap justify-between gap-2"><span>{grader.type.replaceAll("_", " ")}{grader.forbidden ? " · must not match" : ""}</span><span className="mono">weight {grader.weight ?? 1}</span></li>)}
                    </ul>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-bd bg-bg p-3 text-xs leading-6" tabIndex={0} aria-label={`Task prompt for ${c.name}`}>{c.prompt}</pre>
                  </details>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <Link href={`/runs/new?caseIds=${encodeURIComponent(c.id)}`} className="analysis-control case-setup-action min-h-11">Set up this case <ArrowRight aria-hidden="true" className="size-3.5" /></Link>
                    {["visual-map-route-planner-v2", "visual-data-story-card-v2", "visual-kinetic-marble-lab", "visual-firefly-garden", "visual-pocket-rhythm"].includes(c.id) && <Link href={`/cases/playground#${c.id.replace(/^visual-/, "")}`} className="analysis-control min-h-11"><Play aria-hidden="true" className="size-3.5" />Try reference demo</Link>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {total === 0 && (
        <div className="card p-8 sm:p-12 text-center" role="status">
          <Search className="size-6 text-fg-dim mx-auto mb-2" />
          <div className="text-sm text-fg-muted">{query.trim() ? <>No cases match “{query.trim()}”.</> : <>No cases in this category.</>}</div>
          <div className="mt-2 text-xs text-fg-dim">{query.trim() ? "Try a different search, or browse the full library on the" : "Browse the full library on the"} <Link href="/cases" className="text-accent-soft hover:underline">cases page</Link>.</div>
          {query.trim() && <button
            type="button"
            onClick={() => { changeQuery(""); searchRef.current?.focus(); }}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-bd px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-3" /> Clear search
          </button>}
        </div>
      )}
    </>
  );
}
