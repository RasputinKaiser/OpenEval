"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "../StatusBadge";
import { Hash, Loader2, Palette, PlayCircle, Search } from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { presentRunnerCost } from "@/lib/cost-display";
import { summarizeCaseTrust } from "./trust";
import type { StatusCounts } from "./RunHero";

/**
 * Case list: filter chips, search, bulk selection, and per-case rows. Sticky
 * on tall desktop pages so navigation stays visible while reading the long
 * evidence panel on the right.
 */
export default function CaseListPanel({
  cases,
  counts,
  passRatio,
  live,
  selectedIdx,
  onSelect,
  model,
}: {
  cases: RunCaseRecord[];
  counts: StatusCounts;
  passRatio: number;
  live: boolean;
  selectedIdx: number | null;
  onSelect: (index: number) => void;
  model?: string;
}) {
  const [caseSearch, setCaseSearch] = useState("");
  const debouncedCaseSearch = useDebouncedValue(caseSearch, 200);
  const [caseFilter, setCaseFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const caseSearchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(caseSearchRef);

  const visibleCases = useMemo(() => {
    const q = debouncedCaseSearch.trim().toLowerCase();
    return cases
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (caseFilter !== "all" && c.status !== caseFilter) return false;
        if (!q) return true;
        return c.case_name.toLowerCase().includes(q) ||
          c.case_id.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q);
      });
  }, [cases, debouncedCaseSearch, caseFilter]);

  function toggleSelect(caseId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (visibleCases.every(({ c }) => prev.has(c.id))) {
        visibleCases.forEach(({ c }) => next.delete(c.id));
      } else {
        visibleCases.forEach(({ c }) => next.add(c.id));
      }
      return next;
    });
  }

  return (
    <section className="card overflow-hidden flex flex-col lg:sticky lg:top-4 lg:self-start">
      <div className="px-4 py-3 border-b border-bd flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="size-3.5 text-fg-muted" />
          <span className="text-sm font-medium">Cases</span>
          <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev">{cases.length}</span>
        </div>
        {live && <Loader2 className="size-3.5 text-accent-soft animate-spin" />}
      </div>

      <div className="px-4 py-2 border-b border-bd-subtle flex flex-wrap items-center gap-2 text-[11px]">
        <button onClick={() => setCaseFilter("all")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "all" ? "bg-bg-elev text-fg" : "text-fg-muted hover:text-fg")}>All</button>
        <button onClick={() => setCaseFilter("passed")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "passed" ? "bg-ok/15 text-ok" : "text-ok hover:opacity-80")}>● {counts.passed}</button>
        <button onClick={() => setCaseFilter("failed")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "failed" ? "bg-err/15 text-err" : "text-err hover:opacity-80")}>● {counts.failed}</button>
        <button onClick={() => setCaseFilter("error")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "error" ? "bg-warn/15 text-warn" : "text-warn hover:opacity-80")}>! {counts.error}</button>
        {counts.running > 0 && <button onClick={() => setCaseFilter("running")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "running" ? "bg-accent/15 text-accent-soft" : "text-accent-soft hover:opacity-80")}>● {counts.running}</button>}
        {counts.pending > 0 && <button onClick={() => setCaseFilter("pending")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "pending" ? "bg-bg-elev text-fg" : "text-fg-dim hover:text-fg")}>● {counts.pending}</button>}
        <span className="ml-auto mono text-fg-muted">{visibleCases.length}/{cases.length} · {passRatio}%</span>
      </div>

      {cases.length > 6 && (
        <div className="px-4 py-2 border-b border-bd-subtle">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
            <input
              ref={caseSearchRef}
              value={caseSearch}
              onChange={(e) => setCaseSearch(e.target.value)}
              placeholder="Filter cases…"
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-bg border border-bd rounded-md focus:outline-none focus:border-accent placeholder:text-fg-dim"
            />
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="px-4 py-2 border-b border-bd-subtle flex items-center gap-3 bg-accent/5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleCases.every(({ c }) => selectedIds.has(c.id)) && visibleCases.length > 0}
              onChange={toggleSelectAllVisible}
              className="accent-accent"
            />
            <span className="text-[11px] text-fg-muted">{selectedIds.size} selected</span>
          </label>
          <Link
            href={`/runs/new?caseIds=${encodeURIComponent(Array.from(selectedIds).join(","))}${model ? `&model=${encodeURIComponent(model)}` : ""}`}
            className="text-[11px] text-accent-soft hover:underline inline-flex items-center gap-1"
          >
            <PlayCircle className="size-3" /> Re-run selected
          </Link>
          <button
            onClick={() => { navigator.clipboard?.writeText(Array.from(selectedIds).join(", ")); }}
            className="text-[11px] text-fg-muted hover:text-fg"
          >
            Copy IDs
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-fg-dim hover:text-fg ml-auto">
            Clear
          </button>
        </div>
      )}

      <div className="scroll-contain max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-bd-subtle">
        {visibleCases.map(({ c, i }) => (
          <CaseRow
            key={c.id}
            c={c}
            index={i}
            selected={selectedIdx === i}
            checked={selectedIds.has(c.id)}
            onSelect={() => onSelect(i)}
            onToggleCheck={() => toggleSelect(c.id)}
            model={model}
          />
        ))}
        {visibleCases.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-fg-muted">
            No cases match the current filter.
          </div>
        )}
      </div>
    </section>
  );
}

function CaseRow({
  c,
  index,
  selected,
  checked,
  onSelect,
  onToggleCheck,
  model,
}: {
  c: RunCaseRecord;
  index: number;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  model?: string;
}) {
  const runner = c.runner_result;
  const rerunHref = `/runs/new?caseIds=${encodeURIComponent(c.case_id)}${model ? `&model=${encodeURIComponent(model)}` : ""}`;
  const tokPerSec = runner && runner.durationMs > 0
    ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1)
    : "—";
  const cost = runner ? presentRunnerCost(runner.usage).value : "—";
  const caseTrust = summarizeCaseTrust(c);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      className={clsx(
        "group w-full text-left py-2.5 flex items-center gap-3 transition-colors cursor-pointer",
        selected ? "bg-accent/10" : "hover:bg-bg-elev"
      )}
    >
      <div className={clsx(
        "ml-3 h-6 w-1 shrink-0 rounded-full",
        c.status === "passed" ? "bg-ok" :
        c.status === "failed" ? "bg-err" :
        c.status === "error" ? "bg-warn" :
        c.status === "running" || c.status === "grading" ? "bg-accent-soft animate-pulse" :
        "bg-bd-subtle"
      )} />
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        onClick={(e) => e.stopPropagation()}
        className="accent-accent shrink-0 size-3"
      />
      <span className="text-[10px] text-fg-dim mono w-6 shrink-0">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm">{c.case_name}</div>
          {c.case_def?.visual?.expected_artifacts?.length ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent-soft/10 px-1.5 py-0.5 text-[10px] text-accent-soft">
              <Palette className="size-3" /> preview
            </span>
          ) : null}
        </div>
        <div className="text-[10px] text-fg-dim mono mt-0.5 flex items-center gap-1.5">
          <span className="px-1 rounded bg-bg-elev">{c.category}</span>
          {runner && <span>· turns {runner.numTurns} · {runner.toolCalls.length} tools</span>}
        </div>
      </div>
      <Link
        href={rerunHref}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Re-run ${c.case_name}`}
        className="shrink-0 inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-[10px] text-accent-soft opacity-60 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft/40 transition-opacity hover:underline"
      >
        <PlayCircle className="size-3.5" /> Re-run
      </Link>
      {runner && (
        <div className="hidden md:flex flex-col items-end text-[10px] mono text-fg-dim gap-0.5 mr-1">
          <span>{tokPerSec} tok/s</span>
          <span>{cost}</span>
        </div>
      )}
      <span className={clsx(
        "hidden sm:inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] mono",
        caseTrust.score >= 80 ? "border-ok/30 bg-ok/10 text-ok" : caseTrust.score >= 60 ? "border-warn/30 bg-warn/10 text-warn" : "border-err/30 bg-err/10 text-err"
      )}>
        {caseTrust.score}
      </span>
      <StatusBadge status={c.status} size="xs" />
    </div>
  );
}
