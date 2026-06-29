"use client";

import { memo, useMemo, useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle, Search, ArrowUpDown } from "lucide-react";
import clsx from "clsx";
import { evidenceLabel } from "@/lib/accuracy";
import type { AccuracyAudit, CaseAccuracyAudit } from "@/lib/accuracy";
import type { EvidenceTier } from "@/lib/types";

interface Props {
  audit: AccuracyAudit;
}

const CATEGORIES = ["agentic-swe", "single-tool", "reasoning", "visual-code"] as const;
type CategoryFilter = "all" | (typeof CATEGORIES)[number];
type SortKey = "name" | "weaknesses" | "category";
type StatFilter = "oracle" | "deterministic" | "knownBad" | "weak" | null;

export default function AccuracyClient({ audit }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<SortKey>("weaknesses");
  const [statFilter, setStatFilter] = useState<StatFilter>(null);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of audit.cases) {
      map.set(c.category, (map.get(c.category) || 0) + 1);
    }
    return map;
  }, [audit.cases]);

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = audit.cases.filter((row) => {
      if (category !== "all" && row.category !== category) return false;
      if (statFilter === "oracle" && !row.hasOracle) return false;
      if (statFilter === "deterministic" && row.tiers.deterministic + row.tiers.trace === 0) return false;
      if (statFilter === "knownBad" && !row.hasKnownBad) return false;
      if (statFilter === "weak" && row.weaknesses.length === 0) return false;
      if (q) {
        return (
          row.id.toLowerCase().includes(q) ||
          row.name.toLowerCase().includes(q) ||
          row.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
    filtered.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "category") return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      return b.weaknesses.length - a.weaknesses.length || a.name.localeCompare(b.name);
    });
    return filtered;
  }, [audit.cases, category, statFilter, query, sort]);

  function toggleStat(f: StatFilter) {
    setStatFilter((current) => (current === f ? null : f));
  }

  const oraclePct = pct(audit.oracleCases, audit.totalCases);
  const deterministicPct = pct(audit.deterministicOrTraceCases, audit.totalCases);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="size-6 text-accent-soft" /> Accuracy audit
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Measures benchmark trust surfaces: oracle coverage, no-op rejection readiness, evidence tiers, and visual contracts.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat
          label="Oracle coverage"
          value={`${oraclePct}%`}
          sub={`${audit.oracleCases}/${audit.totalCases} cases`}
          active={statFilter === "oracle"}
          onClick={() => toggleStat("oracle")}
        />
        <Stat
          label="Deterministic/trace"
          value={`${deterministicPct}%`}
          sub={`${audit.deterministicOrTraceCases}/${audit.totalCases} cases`}
          active={statFilter === "deterministic"}
          onClick={() => toggleStat("deterministic")}
        />
        <Stat
          label="Known-bad scripts"
          value={`${audit.knownBadCases}`}
          sub="explicit adversarial fixtures"
          active={statFilter === "knownBad"}
          onClick={() => toggleStat("knownBad")}
        />
        <Stat
          label="Weak cases"
          value={`${audit.weakCases}`}
          sub="need stronger proof"
          tone={audit.weakCases ? "warn" : "ok"}
          active={statFilter === "weak"}
          onClick={() => toggleStat("weak")}
        />
      </section>

      <section className="card p-3 mb-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <FilterChip active={category === "all"} onClick={() => setCategory("all")}>
            all · {audit.totalCases}
          </FilterChip>
          {CATEGORIES.map((cat) => (
            <FilterChip key={cat} active={category === cat} onClick={() => setCategory(cat)}>
              {cat} · {categoryCounts.get(cat) ?? 0}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cases…"
              className="w-full sm:w-56 pl-8 pr-3 py-1.5 text-sm bg-bg border border-bd rounded-md focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="size-3.5 text-fg-dim" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="px-2 py-1.5 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent"
            >
              <option value="weaknesses">Weakness count</option>
              <option value="name">Name</option>
              <option value="category">Category</option>
            </select>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="text-sm font-medium mb-3">Evidence mix</h2>
            <div className="space-y-2">
              {Object.entries(audit.tierTotals).map(([tier, count]) => (
                <div key={tier} className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">{evidenceLabel(tier as EvidenceTier)}</span>
                  <span className="mono">{count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-medium mb-2">Visual evaluation boundary</h2>
            <p className="text-xs text-fg-muted leading-relaxed">
              Vision input and visual-code output are separate capabilities. A text-only model can still be evaluated on generated SVG,
              Three.js, web UI, and app UI artifacts as long as the verifier inspects rendered output externally.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Mini label="Visual contracts" value={String(audit.visualCases)} />
              <Mini label="Vision input" value={String(audit.visionInputCases)} />
            </div>
          </section>
        </div>

        <section className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle text-sm font-medium flex items-center justify-between">
            <span>Case proof quality</span>
            <span className="text-[11px] text-fg-dim mono">{rows.length} of {audit.cases.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">
                    <button onClick={() => setSort(sort === "name" ? "weaknesses" : "name")} className={clsx("inline-flex items-center gap-1 hover:text-fg transition-colors", sort === "name" && "text-accent-soft")}>
                      Case {sort === "name" ? "↑" : ""}
                    </button>
                  </th>
                  <th className="text-left px-4 py-2 font-medium">Oracle</th>
                  <th className="text-left px-4 py-2 font-medium">Known bad</th>
                  <th className="text-left px-4 py-2 font-medium">Evidence</th>
                  <th className="text-left px-4 py-2 font-medium">
                    <button onClick={() => setSort(sort === "weaknesses" ? "name" : "weaknesses")} className={clsx("inline-flex items-center gap-1 hover:text-fg transition-colors", sort === "weaknesses" && "text-accent-soft")}>
                      Weaknesses {sort === "weaknesses" ? "↓" : ""}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bd-subtle">
                {rows.map((row) => (
                  <CaseRow key={row.id} row={row} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-muted">
                      No cases match the filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "text-[11px] px-2.5 py-1.5 rounded-md border mono transition-colors",
        active ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
      )}
    >
      {children}
    </button>
  );
}

const TIER_COLORS: Record<EvidenceTier, string> = {
  deterministic: "bg-ok/10 text-ok",
  trace: "bg-accent/10 text-accent-soft",
  visual: "bg-blue-500/10 text-blue-400",
  llm_judge: "bg-warn/10 text-warn",
  manual: "bg-bg-elev text-fg-dim",
};

const CaseRow = memo(function CaseRow({ row }: { row: CaseAccuracyAudit }) {
  return (
    <tr className="hover:bg-bg-elev">
      <td className="px-4 py-2">
        <div className="font-medium">{row.name}</div>
        <div className="text-[10px] text-fg-dim mono">{row.id} · {row.category} · {row.difficulty}</div>
      </td>
      <td className="px-4 py-2"><Bool ok={row.hasOracle} /></td>
      <td className="px-4 py-2"><Bool ok={row.hasKnownBad} /></td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {Object.entries(row.tiers).filter(([, count]) => count > 0).map(([tier, count]) => (
            <span key={tier} className={clsx("text-[10px] mono px-1.5 py-0.5 rounded", TIER_COLORS[tier as EvidenceTier] ?? "bg-bg-elev text-fg-muted")}>
              {evidenceLabel(tier as EvidenceTier)} {count}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-2 max-w-md">
        {row.weaknesses.length ? (
          <div className="flex flex-wrap gap-1">
            {row.weaknesses.map((w) => <span key={w} className="text-[10px] text-warn mono px-1.5 py-0.5 rounded bg-warn/10">{w}</span>)}
          </div>
        ) : <span className="text-xs text-ok">covered</span>}
      </td>
    </tr>
  );
});

function Stat({ label, value, sub, tone, active, onClick }: { label: string; value: string; sub: string; tone?: "ok" | "warn"; active?: boolean; onClick?: () => void; }) {
  const c = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg";
  const body = (
    <>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
        {tone && <div className={clsx("size-1.5 rounded-full", tone === "ok" ? "bg-ok" : "bg-warn")} />}
      </div>
      <div className={clsx("text-xl font-semibold mono tabular-nums", c)}>{value}</div>
      <div className="text-[11px] text-fg-dim mt-0.5">{sub}</div>
    </>
  );
  if (!onClick) return <div className="card p-4">{body}</div>;
  return (
    <button
      onClick={onClick}
      className={clsx("card p-4 text-left transition-colors relative overflow-hidden", active ? "border-accent bg-accent/10" : "hover:bg-bg-elev")}
    >
      {active && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-soft" />}
      {body}
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bd-subtle p-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mono text-sm mt-0.5">{value}</div>
    </div>
  );
}

function Bool({ ok }: { ok: boolean }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-xs text-ok"><CheckCircle2 className="size-3.5" /> yes</span>
    : <span className="inline-flex items-center gap-1 text-xs text-fg-dim"><XCircle className="size-3.5" /> no</span>;
}

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 100) : 0;
}
