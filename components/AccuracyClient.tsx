"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  CircleHelp,
  Eye,
  Filter,
  MinusCircle,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import {
  ACCURACY_SURFACES,
  accuracyStatusLabel,
  accuracySurfaceLabel,
  evidenceLabel,
  type AccuracyStatus,
  type AccuracySurface,
  type AccuracySurfaceAudit,
  type CaseAccuracyAudit,
  type CaseEvidence,
  type CorpusAudit,
  type AccuracyAudit,
} from "@/lib/accuracy";
import type { EvidenceTier } from "@/lib/types";
import PageHeader from "./PageHeader";
import Link from "next/link";
import EvaluateNav from "./EvaluateNav";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";
import CalibrationWorkbench from "./CalibrationWorkbench";

interface Props {
  audit: AccuracyAudit;
  judge: { harness: string; model?: string; reasoningEffort?: string };
}

type SortKey = "name" | "weaknesses" | "category";
type FilterKey = AccuracySurface | "weak" | null;

const TIER_COLORS: Record<EvidenceTier, string> = {
  deterministic: "bg-bg-elev text-ok",
  trace: "bg-bg-elev text-accent-soft",
  visual: "bg-accent/10 text-accent-soft",
  llm_judge: "bg-bg-elev text-warn",
  manual: "bg-bg-elev text-fg-dim",
};

const STATUS_META: Record<AccuracyStatus, { icon: typeof CheckCircle2; className: string; short: string }> = {
  pass: { icon: CheckCircle2, className: "text-ok", short: "pass" },
  fail: { icon: XCircle, className: "text-err", short: "fail" },
  unknown: { icon: CircleHelp, className: "text-accent-soft", short: "unknown" },
  not_applicable: { icon: MinusCircle, className: "text-fg-dim", short: "n/a" },
};

export default function AccuracyClient({ audit, judge }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("weaknesses");
  const [filter, setFilter] = useState<FilterKey>(null);
  const [evidenceStatus, setEvidenceStatus] = useState<AccuracyStatus | null>(null);
  const [chartSurface, setChartSurface] = useState<AccuracySurface>("tests");
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const surface = params.get("surface"), status = params.get("evidenceStatus"), graphic = params.get("chartSurface"), order = params.get("sort");
      setFilter(surface === "weak" || ACCURACY_SURFACES.includes(surface as AccuracySurface) ? surface as FilterKey : null);
      setEvidenceStatus(status === "pass" || status === "fail" || status === "unknown" || status === "not_applicable" ? status : null);
      setChartSurface(ACCURACY_SURFACES.includes(graphic as AccuracySurface) ? graphic as AccuracySurface : "tests");
      setCategory(params.get("category") ?? "all"); setQuery(params.get("q") ?? "");
      setSort(order === "name" || order === "category" ? order : "weaknesses");
    };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const changeFilters = (patch: Record<string, string | null>, replace = false) => {
    const url = new URL(window.location.href);
    for (const [key,value] of Object.entries(patch)) { if (value === null) url.searchParams.delete(key); else url.searchParams.set(key,value); }
    if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const coverage = audit.surfaces[chartSurface];
  const coverageRows = [
    { id: "pass", label: "Passed structural checks", value: coverage.passingCases, tone: "ok" as const },
    { id: "fail", label: "Failed structural checks", value: coverage.failingCases, tone: "err" as const },
    { id: "unknown", label: "Unknown / proof unavailable", value: coverage.unknownCases, tone: "warn" as const },
    { id: "not_applicable", label: "Not applicable", value: coverage.notApplicableCases, tone: "accent" as const },
  ];
  const emptyCorpus = audit.totalCases === 0 && audit.corpus.invalidFiles === 0;
  const displayStatus: AccuracyStatus = emptyCorpus ? "unknown" : audit.status;

  const categories = useMemo(
    () => [...new Set(audit.cases.map((row) => row.category))].sort((a, b) => a.localeCompare(b)),
    [audit.cases],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of audit.cases) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return counts;
  }, [audit.cases]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = audit.cases.filter((row) => {
      if (category !== "all" && row.category !== category) return false;
      if (filter === "weak" && row.weaknesses.length === 0) return false;
      if (filter && filter !== "weak" && row.evidence[filter].status === "not_applicable" && evidenceStatus !== "not_applicable") return false;
      if (evidenceStatus && row.evidence[filter && filter !== "weak" ? filter : chartSurface].status !== evidenceStatus) return false;
      const searchable = [
        row.id,
        row.name,
        row.category,
        row.difficulty,
        ...row.weaknesses,
        ...row.uncertainties,
      ].join(" ").toLowerCase();
      if (q && !searchable.includes(q)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "category") return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      return b.weaknesses.length - a.weaknesses.length || b.uncertainties.length - a.uncertainties.length || a.name.localeCompare(b.name);
    });
    return filtered;
  }, [audit.cases, category, filter, query, sort, evidenceStatus, chartSurface]);

  const filterLabel = filter === "weak" ? "weak cases" : filter ? accuracySurfaceLabel(filter) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <PageHeader
        icon={ShieldCheck}
        title="Accuracy audit"
        subtitle="See which evaluation checks are verified and which still need runtime, visual, or human evidence."
      />
      <EvaluateNav />

      <section className="mb-5 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]" aria-label="Evaluation evidence actions">
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-accent-soft">Evidence loop</div>
          <p className="mt-1 text-sm font-medium">Use this audit before trusting a score.</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">Cases define what a run can prove. Fix weak contracts, run the affected cases, then compare the resulting evidence.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/cases" className="inline-flex min-h-10 items-center rounded-md border border-bd px-2.5 py-1.5 text-accent-soft hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Inspect cases →</Link>
            <Link href="/runs/new" className="inline-flex min-h-10 items-center rounded-md border border-bd px-2.5 py-1.5 text-accent-soft hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Run a suite →</Link>
            <Link href="/runs" className="inline-flex min-h-10 items-center rounded-md border border-bd px-2.5 py-1.5 text-accent-soft hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Review runs →</Link>
          </div>
        </div>
        <div className="rounded-lg border border-bd-subtle bg-bg-subtle p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-fg-muted">Judge posture</div>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent-soft mono">configuration only</span>
          </div>
          <div className="mt-2 text-sm font-medium mono break-all">{judge.harness}{judge.model ? ` / ${judge.model}` : ""}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-dim">{judge.reasoningEffort ? `Reasoning effort: ${judge.reasoningEffort}. ` : ""}A judge verdict is evidence only when the selected backend returns a valid score.</p>
        </div>
      </section>

      <section className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-bd bg-bg-subtle px-3 py-2.5" aria-label="Audit posture">
        <StatusBadge status={displayStatus} />
        <span className="text-sm text-fg-muted">{audit.corpus.summary}</span>
        <span className="text-[11px] text-fg-dim mono">{audit.failedCases} failing · {audit.unknownCases} unknown case surfaces · structural checks only</span>
      </section>



      {audit.status === "fail" && (
        <section
          className="mb-5 rounded-lg border p-3.5"
          style={{
            borderColor: "color-mix(in srgb, var(--color-err) 30%, var(--color-bd))",
            background: "color-mix(in srgb, var(--color-err) 5%, var(--color-bg-subtle))",
          }}
          role="alert"
          aria-labelledby="accuracy-action-title"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-err" />
            <div>
              <h2 id="accuracy-action-title" className="text-sm font-medium text-err">Action needed before treating this corpus as decision-grade</h2>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                Fix the failing surfaces below first. Unknown means proof is not attached, not that the case passed or failed.
              </p>
              {audit.corpus.issues.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-fg-muted" aria-label="Corpus loader issues">
                  {audit.corpus.issues.slice(0, 6).map((issue) => <li key={issue} className="mono">{issue}</li>)}
                  {audit.corpus.issues.length > 6 && <li>+ {audit.corpus.issues.length - 6} more loader issues</li>}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 mb-5 md:grid-cols-3 xl:grid-cols-6" aria-label="Accuracy summary">
        <Stat label="Audit posture" value={accuracyStatusLabel(displayStatus)} sub={`${audit.failedCases} fail · ${audit.unknownCases} unknown`} tone={displayStatus === "pass" ? "ok" : displayStatus === "fail" ? "warn" : undefined} />
        <Stat label="Oracle coverage" value={ratio(audit.oracleCases, audit.totalCases)} sub={`${audit.oracleCases}/${audit.totalCases} cases`} />
        <Stat label="Deterministic" value={ratio(audit.deterministicOrTraceCases, audit.totalCases)} sub="tests or trace backstop" />
        <Stat label="Known-bad" value={ratio(audit.knownBadCases, audit.totalCases)} sub="rejection scripts" />
        <Stat label="Visual contracts" value={String(audit.visualCases)} sub={`${audit.visionInputCases} need image input`} />
        <Stat label="Weak cases" value={String(audit.weakCases)} sub="concrete gaps" tone={audit.weakCases ? "warn" : "ok"} />
      </section>

      <section className="mb-5" aria-labelledby="evidence-surfaces-title">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="evidence-surfaces-title" className="text-sm font-medium">Evidence surfaces</h2>
            <p className="mt-0.5 text-xs text-fg-dim">Select a surface to inspect its applicable cases. Counts are cases, not a fabricated pass rate.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] mono" aria-label="Audit status legend">
            <StatusLegend status="pass" />
            <StatusLegend status="fail" />
            <StatusLegend status="unknown" />
            <StatusLegend status="not_applicable" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <CorpusCard corpus={audit.corpus} />
          {ACCURACY_SURFACES.map((surface) => (
            <SurfaceCard
              key={surface}
              surface={surface}
              audit={audit.surfaces[surface]}
              active={filter === surface}
              onClick={() => changeFilters({ surface: filter === surface ? null : surface, evidenceStatus: null })}
            />
          ))}
        </div>
      </section>

      <div className="mb-5"><ChartFrame title="Evidence coverage" description="Counts cover the complete case audit. Explore replaces the proof-matrix filters with this surface and status. Passed means structural checks passed; it does not claim runtime success." unit={`${accuracySurfaceLabel(chartSurface)} · ${audit.totalCases} case definitions`}
        actions={<label className="text-xs text-fg-muted">Surface <select className="analysis-input" value={chartSurface} onChange={(event) => changeFilters({ chartSurface: event.target.value })}>{ACCURACY_SURFACES.map((surface) => <option key={surface} value={surface}>{accuracySurfaceLabel(surface)}</option>)}</select></label>}
        table={{ headers: ["Evidence state", "Cases"], rows: coverageRows.map((row) => ({ id: row.id, cells: [row.label, row.value] })) }}>
        <SelectableBars rows={coverageRows} noun="cases" onExplore={(status) => changeFilters({ surface: chartSurface, evidenceStatus: status, category: null, q: null })} />
      </ChartFrame></div>
      <details className="card p-4 mb-5"><summary className="cursor-pointer text-sm font-medium">Coverage matrix across every evidence surface</summary><p className="text-xs text-fg-muted my-3">Select a cell to inspect its case definitions. Structural coverage and runtime evidence remain separate.</p><div className="analysis-table analysis-reveal" role="region" tabIndex={0} aria-label="Accuracy coverage matrix"><table><thead><tr><th>Surface</th>{["Pass", "Fail", "Unknown", "Not applicable"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{ACCURACY_SURFACES.map(surface => { const row = audit.surfaces[surface]; return <tr key={surface}><th>{accuracySurfaceLabel(surface)}</th>{([{ status: "pass", count: row.passingCases }, { status: "fail", count: row.failingCases }, { status: "unknown", count: row.unknownCases }, { status: "not_applicable", count: row.notApplicableCases }]).map(cell => <td key={cell.status}><button className="analysis-control w-full justify-center" type="button" aria-label={`${accuracySurfaceLabel(surface)} ${cell.status}: ${cell.count} cases`} onClick={() => changeFilters({ surface, chartSurface: surface, evidenceStatus: cell.status, category: null, q: null })}>{cell.count}</button></td>)}</tr>; })}</tbody></table></div></details>
      <section className="card p-3 mb-5" aria-label="Case filters">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-visible" aria-label="Case categories">
            <Filter aria-hidden="true" className="mr-1 size-3.5 text-fg-dim" />
            <FilterChip active={category === "all"} onClick={() => changeFilters({ category: null })}>
              all · {audit.totalCases}
            </FilterChip>
            {categories.map((item) => (
              <FilterChip key={item} active={category === item} onClick={() => changeFilters({ category: item })}>
                {item} · {categoryCounts.get(item) ?? 0}
              </FilterChip>
            ))}
            <FilterChip active={filter === "weak"} onClick={() => changeFilters({ surface: filter === "weak" ? null : "weak", evidenceStatus: null })}>
              weak · {audit.weakCases}
            </FilterChip>
          </div>
          <div className="flex w-full items-center gap-2 lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:flex-initial">
              <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim" />
              <input
                value={query}
                onChange={(event) => changeFilters({ q: event.target.value || null }, true)}
                placeholder="Search cases…"
                aria-label="Search accuracy cases"
                className="min-h-10 w-full rounded-md border border-bd bg-bg py-1.5 pl-8 pr-3 text-sm focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:w-56"
              />
            </div>
            <ArrowUpDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-dim" />
            <select
              value={sort}
              onChange={(event) => changeFilters({ sort: event.target.value === "weaknesses" ? null : event.target.value })}
              aria-label="Sort accuracy cases"
              className="min-h-10 rounded-md border border-bd bg-bg px-2 py-1.5 text-sm mono focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="weaknesses">Weakness count</option>
              <option value="name">Name</option>
              <option value="category">Category</option>
            </select>
          </div>
        </div>
        <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-2 text-[11px] text-fg-dim" aria-live="polite">
          <span>{rows.length} of {audit.cases.length} cases shown{filterLabel ? ` · ${filterLabel}` : ""}</span>
          {evidenceStatus && <button type="button" className="analysis-control" onClick={() => changeFilters({ evidenceStatus: null })}>Remove status: {accuracyStatusLabel(evidenceStatus)}</button>}
          {filter && <button onClick={() => changeFilters({ surface: null, evidenceStatus: null })} className="rounded px-1 text-accent-soft underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Clear surface filter</button>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="card overflow-hidden" aria-labelledby="case-proof-title">
          <div className="flex items-center justify-between gap-3 border-b border-bd-subtle px-4 py-2.5">
            <div>
              <h2 id="case-proof-title" className="text-sm font-medium">Case proof matrix</h2>
              <p className="mt-0.5 text-[11px] text-fg-dim">Hover or focus a status for its exact audit meaning.</p>
            </div>
            <span className="shrink-0 text-[11px] text-fg-dim mono">{rows.length} / {audit.cases.length}</span>
          </div>
          <div className="chart-scroll-well overflow-x-auto pb-2">
            <table className="w-full min-w-[980px] text-sm">
              <caption className="sr-only">Per-case accuracy evidence status and actionable weaknesses</caption>
              <thead className="sticky top-0 z-10 border-b border-bd-subtle bg-bg-subtle text-[10px] uppercase tracking-[0.12em] text-fg-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-20 border-r border-bd-subtle bg-bg-subtle px-4 py-2 text-left font-medium">Case</th>
                  {ACCURACY_SURFACES.map((surface) => <th key={surface} className="px-2 py-2 text-left font-medium">{shortSurfaceLabel(surface)}</th>)}
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bd-subtle">
                {rows.map((row) => <CaseRow key={row.id} row={row} />)}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={ACCURACY_SURFACES.length + 2} className="px-4 py-10 text-center text-sm text-fg-muted">
                      <div role="status">
                        <p>{audit.cases.length === 0 ? "No accuracy cases are available yet." : "No cases match the filters."}</p>
                        {audit.cases.length === 0 ? (
                          <Link href="/cases" className="mt-2 inline-flex text-xs text-accent-soft underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                            Open case library →
                          </Link>
                        ) : filter || evidenceStatus || category !== "all" || query ? (
                          <button type="button" onClick={() => changeFilters({ surface: null, evidenceStatus: null, category: null, q: null })} className="mt-2 text-xs text-accent-soft underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                            Clear filters
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4" aria-label="Audit interpretation">
          <section className="card p-4">
            <h2 className="text-sm font-medium">How to read this</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-fg-dim">This route audits case-definition contracts and local oracle availability. It does not replay an agent, run a judge, or inspect rendered pixels.</p>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-fg-muted">
              <li><StatusBadge status="pass" compact /> Structural evidence is present and verified by this audit.</li>
              <li><StatusBadge status="fail" compact /> A concrete authoring or resolution gap is detected.</li>
              <li><StatusBadge status="unknown" compact /> A contract exists, but runtime or human proof is not attached.</li>
              <li><StatusBadge status="not_applicable" compact /> The case does not declare that evidence surface.</li>
            </ul>
          </section>
          <section className="card p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Eye aria-hidden="true" className="size-4 text-accent-soft" /> Visual boundary</div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">
              {audit.visualCases} cases declare artifact contracts. This page distinguishes structural/artifact evidence from rendered quality; a byte receipt is never presented as a pixel verdict.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Mini label="Contracts" value={String(audit.visualCases)} />
              <Mini label="Image input" value={String(audit.visionInputCases)} />
            </div>
          </section>
          <section className="card p-4">
            <h2 className="text-sm font-medium">Evidence tier inventory</h2>
            <div className="mt-3 space-y-2">
              {Object.entries(audit.tierTotals).map(([tier, count]) => (
                <div key={tier} className="flex items-center justify-between gap-2 text-xs">
                  <span className={clsx("rounded px-1.5 py-0.5 text-[10px] mono", TIER_COLORS[tier as EvidenceTier])}>{evidenceLabel(tier as EvidenceTier)}</span>
                  <span className="text-fg-muted mono">{count}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-fg-dim">Tier counts describe declared grader contracts; they are not run pass counts.</p>
          </section>
          <section className="card p-4">
            <h2 className="text-sm font-medium">Next useful checks</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-fg-muted">
              <li>Run selftest to exercise solve and known-bad scripts.</li>
              <li>Attach visual receipts after rendering artifacts.</li>
              <li>Review weak judge backstops before trusting rubric scores.</li>
            </ul>
          </section>
        </aside>
      </section>
      <details className="mt-6"><summary className="analysis-control cursor-pointer">Calibration workbench · references and observations</summary><CalibrationWorkbench /></details>
    </div>
  );
}

function CorpusCard({ corpus }: { corpus: CorpusAudit }) {
  const status: AccuracyStatus = corpus.validCases === 0 && corpus.invalidFiles === 0 ? "unknown" : corpus.status;
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg-subtle p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">Corpus validity</div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-2 text-lg font-semibold mono tabular-nums">{corpus.validCases}</div>
      <div className="mt-0.5 text-[11px] text-fg-dim">valid cases · {corpus.invalidFiles} loader issues</div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{corpus.summary}</p>
    </div>
  );
}

function SurfaceCard({ surface, audit, active, onClick }: { surface: AccuracySurface; audit: AccuracySurfaceAudit; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Filter by ${accuracySurfaceLabel(surface)}, ${accuracyStatusLabel(audit.status)}`}
      className={clsx(
        "rounded-lg border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "border-accent" : "border-bd-subtle bg-bg-subtle hover:bg-bg-elev",
      )}
      style={active ? { background: "color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-subtle))" } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium">{accuracySurfaceLabel(surface)}</div>
        <StatusBadge status={audit.status} />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-lg font-semibold mono tabular-nums">{audit.passingCases}/{audit.applicableCases}</span>
        <span className="text-[10px] text-fg-dim">pass / applicable</span>
      </div>
      <div className="mt-1 text-[10px] text-fg-dim mono">{audit.declaredEvidence} declared · {audit.verifiedEvidence} verified</div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{audit.summary}</p>
    </button>
  );
}

const CaseRow = memo(function CaseRow({ row }: { row: CaseAccuracyAudit }) {
  return (
    <tr className="align-top hover:bg-bg-elev">
      <th scope="row" className="sticky left-0 z-[1] border-r border-bd-subtle bg-bg px-4 py-2.5 text-left">
        <Link href={`/runs/new?caseIds=${encodeURIComponent(row.id)}`} className="font-medium text-fg hover:text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">
          {row.name}
        </Link>
        <div className="mt-0.5 text-[10px] text-fg-dim mono">{row.id} · {row.category} · {row.difficulty}</div>
        {(row.hasBudget || row.hasVisualContract) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.hasBudget && <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[9px] text-fg-dim mono">budget</span>}
            {row.hasVisualContract && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent-soft mono">visual</span>}
          </div>
        )}
      </th>
      {ACCURACY_SURFACES.map((surface) => <td key={surface} className="px-2 py-2.5"><EvidenceStatus check={row.evidence[surface]} /></td>)}
      <td className="max-w-[280px] px-4 py-2.5">
        {row.weaknesses.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.weaknesses.map((weakness) => <span key={weakness} className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn mono">{weakness}</span>)}
          </div>
        )}
        {row.uncertainties.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.uncertainties.map((uncertainty) => <span key={uncertainty} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent-soft mono">{uncertainty}</span>)}
          </div>
        )}
        {row.weaknesses.length === 0 && row.uncertainties.length === 0 && <span className="text-xs text-ok">no structural gap detected</span>}
        <Link href={`/runs/new?caseIds=${encodeURIComponent(row.id)}`} className="mt-2 inline-flex text-[11px] text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">
          Run this case →
        </Link>
      </td>
    </tr>
  );
});

function EvidenceStatus({ check }: { check: CaseEvidence }) {
  return (
    <span title={check.detail} aria-label={`${accuracyStatusLabel(check.status)}: ${check.detail}`}>
      <StatusBadge status={check.status} compact />
      <span className="mt-0.5 block text-[9px] text-fg-dim mono">{check.declaredEvidence} / {check.verifiedEvidence}</span>
    </span>
  );
}

function StatusBadge({ status, compact = false }: { status: AccuracyStatus; compact?: boolean }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap mono", compact ? "text-[10px]" : "rounded border border-bd-subtle bg-bg px-1.5 py-0.5 text-[10px]", meta.className)}>
      <Icon aria-hidden="true" className={compact ? "size-3" : "size-3"} />
      {accuracyStatusLabel(status)}
    </span>
  );
}

function StatusLegend({ status }: { status: AccuracyStatus }) {
  return <span className={STATUS_META[status].className}><StatusBadge status={status} compact /></span>;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "min-h-10 rounded-md border px-2.5 py-1.5 text-[11px] mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "border-accent text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev",
      )}
      style={active ? { background: "color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-subtle))" } : undefined}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className="card min-w-0 p-3.5">
      <div className="flex items-center justify-between gap-1">
        <div className="truncate text-[10px] uppercase tracking-[0.12em] text-fg-muted">{label}</div>
        {tone && <div aria-hidden="true" className={clsx("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : "bg-warn")} />}
      </div>
      <div className={clsx("mt-1 text-lg font-semibold mono tabular-nums", color)}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-fg-dim">{sub}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bd-subtle p-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">{label}</div>
      <div className="mt-0.5 text-sm mono">{value}</div>
    </div>
  );
}

function shortSurfaceLabel(surface: AccuracySurface) {
  switch (surface) {
    case "tests": return "Tests";
    case "oracle": return "Oracle";
    case "known_bad": return "Known bad";
    case "trace": return "Trace";
    case "visual": return "Visual";
    case "judge": return "Judge";
    case "manual": return "Manual";
  }
}

function ratio(n: number, d: number) {
  return d > 0 ? `${n}/${d}` : "—";
}
