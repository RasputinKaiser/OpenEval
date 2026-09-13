"use client";
import { SourceCapabilities } from "./SourceCapabilities";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { SessionEvidenceLink } from "./SessionEvidenceLink";
import clsx from "clsx";
import {
  Boxes, RefreshCw, HelpCircle, AlertTriangle, Activity, Search, DatabaseZap,
  Layers, Coins, Hammer, TrendingUp, CalendarClock, Cpu, Wrench, HardDrive, History, BarChart3,
  ShieldCheck,
  ArrowDownWideNarrow, Filter, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import PageHeader from "./PageHeader";
import ModelInspection from "./ModelInspection";
import { modelMeasure as measureModel, modelBarFraction } from "@/lib/model-ranking";
import { SectionHeader } from "./Section";
import { ProgressiveSectionNav, sectionVisibilityClass, useProgressiveSection } from "./mobile/ProgressiveSectionNav";
import { RedactToggle } from "./RedactToggle";
import { compactDisplayPath } from "@/lib/redaction";
import { useRedactedShow } from "@/lib/use-redaction";
import { DAYS, fmtNum, fmtNumFull, fmtUsd, fmtUsdFull, fmtRel, fmtDuration } from "@/lib/format";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import type { RollupReport } from "@/lib/collection/rollup";
import type { FtsHit } from "@/lib/live-cache";
import type { ChartSelection } from "@/lib/chart-analysis";
import { useChartSelection } from "@/lib/use-chart-selection";
import { WeeklyUsageChart, ActivityHeatmap, ToolHealthList } from "./CollectionCharts";
import CollectionAnalysis from "./CollectionAnalysis";
import { EvidenceComposition, EvidenceCoverageRow } from "./evidence/EvidenceComposition";
import { EvidenceReview } from "./evidence/EvidenceReview";


function StatusPill({ status }: { status: "present" | "empty" | "absent" }) {
  const tone = status === "present" ? "bg-ok/15 text-ok" : status === "empty" ? "bg-warn/15 text-warn" : "bg-bg-elev text-fg-dim";
  return <span className={clsx("rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]", tone)}>{status}</span>;
}

/** One evidence-backed metric inside a group. Featured cells own the headline row. */
function StatCell({ label, value, sub, title, tone, featured }: { label: string; value: ReactNode; sub?: ReactNode; title?: string; tone?: string; featured?: boolean }) {
  return (
    <div
      className={clsx(
        "collection-stat min-w-0 px-3 py-2.5",
        featured && "col-span-2 border-b border-bd-subtle bg-bg/35 px-4 py-3",
      )}
      title={title}
    >
      <div className="metric-label">{label}</div>
      <div className={clsx(featured ? "mt-1 text-2xl" : "mt-1 text-lg", "mono font-semibold tabular-nums leading-tight", tone)}>{value}</div>
      <div className={clsx("metric-detail mt-1 text-fg-muted")}>{sub ?? " "}</div>
    </div>
  );
}

function StatGroup({ icon: Icon, label, children, tone = "info" }: { icon: LucideIcon; label: string; children: ReactNode; tone?: "info" | "estimate" | "activity" }) {
  return (
    <div className={`card metric-group metric-group--${tone} min-w-0 overflow-hidden`}>
      <div className="metric-group-heading flex items-center gap-2 border-b border-bd-subtle px-3 py-2">
        <span className="grid size-6 place-items-center rounded-md">
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <div className="grid grid-cols-2 divide-x divide-bd-subtle">{children}</div>
    </div>
  );
}

/** Day-part / weekday split derived from the session-start heatmap. */
function RhythmPanel({ heatmap }: { heatmap: number[][] }) {
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const dayTotals = heatmap.map((row) => row.reduce((a, b) => a + b, 0));
  const total = Math.max(1, dayTotals.reduce((a, b) => a + b, 0));
  const hourTotals = Array.from({ length: 24 }, (_, h) => heatmap.reduce((a, row) => a + row[h], 0));

  const parts = [
    { label: "Morning", range: "06–12", n: hourTotals.slice(6, 12).reduce((a, b) => a + b, 0), opacity: 48 },
    { label: "Afternoon", range: "12–18", n: hourTotals.slice(12, 18).reduce((a, b) => a + b, 0), opacity: 66 },
    { label: "Evening", range: "18–24", n: hourTotals.slice(18, 24).reduce((a, b) => a + b, 0), opacity: 88 },
    { label: "Night", range: "00–06", n: hourTotals.slice(0, 6).reduce((a, b) => a + b, 0), opacity: 34 },
  ];
  const maxPart = Math.max(1, ...parts.map((p) => p.n));
  const dominant = parts.reduce((best, part) => part.n > best.n ? part : best, parts[0]);
  const activePart = parts.find((part) => part.label === selectedPart) ?? dominant;
  const peakDay = dayTotals.indexOf(Math.max(...dayTotals));
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
  const weekendPct = ((dayTotals[5] + dayTotals[6]) / total) * 100;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">Day parts</h3>
        <p className="mt-1 text-[11px] text-fg-dim">How session starts divide across the day.</p>
      </div>

      <div className="mx-4 mt-3 rounded-lg border border-bd-subtle bg-bg/40 p-3">
        <div className="flex items-end justify-between gap-3" aria-live="polite">
          <div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">{selectedPart ? "Selected" : "Dominant window"}</div>
            <div className="mt-0.5 text-base font-semibold">{activePart.label} <span className="text-[11px] font-normal text-fg-dim mono">{activePart.range}</span></div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold mono tabular-nums">{((activePart.n / total) * 100).toFixed(0)}%</div>
            <div className="text-[10px] text-fg-dim mono">{fmtNum(activePart.n)} starts</div>
          </div>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-bg-elev" role="group" aria-label="Session starts by day part">
          {parts.map((part) => (
            <button
              key={part.label}
              type="button"
              aria-label={`${part.label}: ${fmtNumFull(part.n)} starts, ${((part.n / total) * 100).toFixed(0)}%`}
              aria-pressed={activePart.label === part.label}
              onClick={() => setSelectedPart(part.label)}
              className="h-full min-w-[4px] outline-none transition-[filter,box-shadow] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none"
              style={{
                width: `${(part.n / total) * 100}%`,
                background: `color-mix(in srgb, var(--color-accent) ${part.opacity}%, transparent)`,
                boxShadow: activePart.label === part.label ? "inset 0 0 0 1px var(--color-accent-soft)" : undefined,
              }}
              title={`${part.label} ${part.range}: ${fmtNumFull(part.n)} starts`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1 px-3 py-3">
        {parts.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={activePart.label === p.label}
            onClick={() => setSelectedPart(p.label)}
            className={clsx(
              "block min-h-11 w-full rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent",
              activePart.label === p.label ? "bg-bg-elev shadow-sm" : "hover:bg-bg/60",
            )}
            title={`${fmtNumFull(p.n)} sessions started ${p.range}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className={activePart.label === p.label ? "text-fg" : "text-fg-muted"}>
                {p.label} <span className="text-fg-dim text-[9px] mono">{p.range}</span>
              </span>
              <span className="mono tabular-nums text-[11px]">
                {fmtNum(p.n)} <span className="text-fg-dim">· {((p.n / total) * 100).toFixed(0)}%</span>
              </span>
            </div>
            <div
              className="h-[3px] rounded-full mt-1 transition-[width] duration-500 motion-reduce:transition-none"
              style={{
                width: `${p.n > 0 ? Math.max(2, (p.n / maxPart) * 100) : 0}%`,
                background: `color-mix(in srgb, var(--color-accent) ${p.opacity}%, transparent)`,
              }}
            />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 border-t border-bd-subtle bg-bg/25 px-4 py-3 text-[10px]">
        <div>
          <div className="text-fg-dim">Busiest day</div>
          <div className="mt-1 mono tabular-nums">{DAYS[peakDay]} · {((dayTotals[peakDay] / total) * 100).toFixed(0)}%</div>
        </div>
        <div className="text-center">
          <div className="text-fg-dim">Peak hour</div>
          <div className="mt-1 mono tabular-nums">{String(peakHour).padStart(2, "0")}:00</div>
        </div>
        <div className="text-right">
          <div className="text-fg-dim">Weekend</div>
          <div className="mt-1 mono tabular-nums">{weekendPct.toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}

function ProjectRanking({
  projects,
  generatedAtMs,
  formatProject,
}: {
  projects: RollupReport["byProject"];
  generatedAtMs: number;
  formatProject: (project: string) => string;
}) {
  const [selected, setSelected] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const active = projects[Math.min(selected, Math.max(0, projects.length - 1))];
  const maxCost = Math.max(1e-9, ...projects.map((project) => project.costUsd));
  const totalCost = projects.reduce((sum, project) => sum + project.costUsd, 0);
  const visibleProjects = showAll ? projects : projects.slice(0, 4);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">Top projects · all-time API equivalent</h3>
        <p className="mt-1 text-[11px] text-fg-dim">Select a project to inspect volume and recency.</p>
      </div>
      {active && (
        <div className="mx-4 mt-3 rounded-lg border border-bd-subtle bg-bg/40 p-3">
          <div className="truncate text-sm font-medium" title={formatProject(active.project)}>{formatProject(active.project)}</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">API equiv.</div>
              <div className="mt-0.5 mono text-sm font-semibold tabular-nums">{(active.estimatedCostSessions > 0 ? "~" : "") + fmtUsd(active.costUsd)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">Sessions</div>
              <div className="mt-0.5 mono text-sm font-semibold tabular-nums">{fmtNum(active.sessions)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-fg-dim">I/O tokens</div>
              <div className="mt-0.5 mono text-sm font-semibold tabular-nums">{fmtNum(active.tokens)}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-fg-dim mono">active {fmtRel(active.lastActiveMs, generatedAtMs)} · {totalCost > 0 ? ((active.costUsd / totalCost) * 100).toFixed(0) : 0}% of top-project value</div>
        </div>
      )}
      <div className="space-y-0.5 px-3 py-3">
        {visibleProjects.map((project, index) => {
          const isActive = index === selected;
          return (
            <button
              key={project.project}
              type="button"
              aria-pressed={isActive}
              onClick={() => setSelected(index)}
              className={clsx(
                "relative block min-h-11 w-full overflow-hidden rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent",
                isActive ? "bg-bg-elev shadow-sm" : "hover:bg-bg/60",
              )}
              title={`${formatProject(project.project)} · ${fmtNumFull(project.sessions)} sessions · ${fmtNumFull(project.tokens)} input + output tokens`}
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-0 opacity-50"
                style={{
                  width: `${project.costUsd > 0 ? Math.max(2, (project.costUsd / maxCost) * 100) : 0}%`,
                  background: "color-mix(in srgb, var(--color-accent) 9%, transparent)",
                }}
              />
              <span className="relative flex items-center gap-2">
                <span className={clsx("w-5 shrink-0 text-[10px] mono", isActive ? "text-accent-soft" : "text-fg-dim")}>{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <span className={clsx("block truncate text-[11px]", isActive ? "text-fg" : "text-fg-muted")}>{formatProject(project.project).split("/").slice(-2).join("/")}</span>
                  <span className="block text-[9px] text-fg-dim mono">{fmtNum(project.sessions)} sessions</span>
                </span>
                <span className="shrink-0 text-[11px] mono tabular-nums">{(project.estimatedCostSessions > 0 ? "~" : "") + fmtUsd(project.costUsd)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {projects.length > 4 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex min-h-10 w-full items-center justify-center border-t border-bd-subtle px-3 text-[11px] text-fg-muted hover:bg-bg/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          aria-expanded={showAll}
        >
          {showAll ? "Show top 4" : `Show all ${projects.length} projects`}
        </button>
      )}
    </div>
  );
}

/** Thin share bar + percentage, right-aligned — for table share columns. */
function ShareBar({ frac }: { frac: number }) {
  const pct = Math.max(0, Math.min(100, frac * 100));
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="h-1.5 w-20 rounded-full bg-bg-elev overflow-hidden shrink-0" role="img" aria-label={`${pct.toFixed(0)} percent share`}>
        <div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%`, background: "color-mix(in srgb, var(--color-accent) 55%, transparent)" }} />
      </div>
      <span className="text-fg-dim text-[10px] tabular-nums w-8 text-right">{pct < 1 && pct > 0 ? "<1" : pct.toFixed(0)}%</span>
    </div>
  );
}

function PricingEvidence({ model }: { model: AllSourcesResult["byModel"][number] }) {
  const kinds = [
    model.measuredCostSessions > 0 ? "recorded" : null,
    model.allocatedCostSessions > 0 ? "allocated" : null,
    model.listedRateSessions > 0 ? "listed rate" : null,
    model.familyRateSessions > 0 ? "family map" : null,
    model.fallbackRateSessions > 0 ? "fallback" : null,
  ].filter(Boolean) as string[];
  const label = kinds.length === 0 ? "unpriced" : kinds.length === 1 ? kinds[0] : "mixed rates";
  const tone = model.fallbackRateSessions > 0
    ? "text-err"
    : model.familyRateSessions > 0
      ? "text-warn"
      : model.pricedSessions > 0
        ? "text-ok"
        : "text-fg-dim";
  const title = [
    `${fmtNumFull(model.pricedSessions)}/${fmtNumFull(model.sessions)} sessions have a dollar estimate`,
    `${fmtNumFull(model.measuredCostSessions)} recorded costs`,
    `${fmtNumFull(model.allocatedCostSessions)} mixed-model shares allocated from recorded session totals`,
    `${fmtNumFull(model.listedRateSessions)} listed-rate estimates`,
    `${fmtNumFull(model.familyRateSessions)} family-mapped estimates`,
    `${fmtNumFull(model.fallbackRateSessions)} fallback estimates`,
    `${fmtNumFull(model.inferredModelSessions)} sessions have an inferred model id`,
  ].join(" · ");
  return <span className={clsx("model-pricing-evidence text-[10px] uppercase", tone)} title={title}>{label}</span>;
}

/** Compact labeled <select> pill — mirrors the LiveClient sort/filter pills. */
function SelectPill({ icon: Icon, value, onChange, options }: { icon: LucideIcon; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border border-bd bg-bg-elev px-2.5 py-2 text-xs text-fg-muted">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 max-w-[12rem] bg-transparent text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
      </select>
    </label>
  );
}

type SessionSort = "recent" | "tokens" | "duration" | "tools";
type ModelSort = "cost" | "sessions" | "tokens" | "cache" | "tools" | "errors";
const LOAD_STEP = 160;
const MAX_LIMIT = 10_000;
const SEARCH_DEBOUNCE_MS = 400;
const SEARCH_LIMIT = 50;

/**
 * Sticky first column for wide tables: on narrow screens the row identity
 * stays put while the metrics scroll under it. Opaque card background so
 * scrolled cells never show through; header cell sits above sibling headers.
 */
const STICKY_TH = "sticky left-0 z-[2] border-r border-bd-subtle";
const STICKY_TD = "sticky left-0 z-[1] border-r border-bd-subtle bg-bg-subtle";

/** Keep `?q=` in the address bar so a search survives reload/share — without a Next re-render. */
function syncQueryUrl(query: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", url);
}

/** Full `?limit=` response — `AllSourcesResult` plus its continuation cursor. */
type CollectionPayload = AllSourcesResult & { nextCursor?: string | null };

/** Keep client-side row keys and continuation dedupe source-qualified. */
function collectionSessionIdentity(
  session: Pick<AllSourcesResult["sessions"][number], "sourceId" | "sessionId" | "path">,
): string {
  return `${session.sourceId}\u0000${session.sessionId}`;
}

/** Sessions-only `?cursor=` page — no stats/rollups, so paging stays O(page). */
interface CursorPage {
  sessions: AllSourcesResult["sessions"];
  nextCursor: string | null;
  totalParsedSessions: number;
  generatedAtMs: number;
  stale?: boolean;
  refreshing?: boolean;
  refreshError?: string;
}

/**
 * Self-ticking relative label, isolated so the 30s tick re-renders only this
 * span — not the whole (potentially 10k-row) page. Starts at the payload's own
 * reference time so server and client render identically, then a client effect
 * switches to wall-clock.
 */
function ScannedAgo({ generatedAtMs }: { generatedAtMs: number }) {
  const [nowMs, setNowMs] = useState(generatedAtMs);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [generatedAtMs]);
  return (
    <span
      className="text-[11px] text-fg-dim tabular-nums whitespace-nowrap"
      title={`Scan generated ${new Date(generatedAtMs).toISOString()}`}
    >
      scanned {fmtRel(generatedAtMs, nowMs)}
    </span>
  );
}

/**
 * Persistent evidence orientation for the Collection canvas. Collection owns
 * retained-summary and freshness counts; outcome comparability is deliberately
 * handed off to Timeline, whose report owns that denominator and provenance.
 */
function EvidenceRail({
  activeSection,
  onSelect,
  retainedSessions,
  archivedSessions,
  staleSessions,
  refreshing,
  hasError,
  hasCoverageCaveat,
}: {
  activeSection: string;
  onSelect: (sectionId: string) => void;
  retainedSessions: number;
  archivedSessions: number;
  staleSessions: number;
  refreshing: boolean;
  hasError: boolean;
  hasCoverageCaveat: boolean;
}) {
  const snapshotLabel = hasError ? "scan error" : refreshing ? "refreshing" : hasCoverageCaveat ? "partial" : "current";
  const snapshotTone = hasError || hasCoverageCaveat ? "text-warn" : refreshing ? "text-accent-soft" : "text-ok";
  const navItems = [
    { id: "all", label: "All sections", detail: "View the full collection", icon: Layers },
    { id: "overview", label: "Overview", detail: "collection summary", icon: Boxes },
    { id: "fidelity", label: "Evidence quality", detail: "coverage & limits", icon: ShieldCheck },
    { id: "harnesses", label: "Sources", detail: "Local tools and imports", icon: HardDrive },
    { id: "sessions", label: "Sessions", detail: "search retained sessions", icon: Search },
  ];

  return (
    <aside className="mb-4 hidden min-w-0 max-w-full lg:sticky lg:top-4 lg:mb-0 lg:block lg:self-start" aria-label="Collection navigation">
      <div className="card min-w-0 max-w-full overflow-hidden p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-fg">In this collection</h2>
            <p className="mt-1 text-xs leading-snug text-fg-dim">Browse the summary, sources, and sessions.</p>
          </div>
          <span className={clsx("shrink-0 text-xs font-medium", snapshotTone)}>{snapshotLabel}</span>
        </div>
        <div className="mt-3 max-w-full overflow-x-auto overscroll-x-contain lg:overflow-visible">
          <div className="flex w-max min-w-full gap-1 lg:block">
            {navItems.map(({ id, label, detail, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                aria-pressed={activeSection === id}
                aria-current={activeSection === id ? "page" : undefined}
                className={clsx(
                  "flex min-h-10 min-w-[8.5rem] items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:w-full",
                  activeSection === id ? "border-accent/50 bg-accent/10 text-fg" : "border-transparent text-fg-muted hover:bg-bg-elev hover:text-fg",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-accent-soft" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-fg-dim">{detail}</span>
                </span>
              </button>
            ))}
            <Link
              href="/collection/timeline"
              className="flex min-h-10 min-w-[8.5rem] items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:w-full"
            >
              <Activity className="size-3.5 shrink-0 text-accent-soft" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Compare outcomes</span>
                <span className="block text-xs text-fg-dim">Compare session outcomes</span>
              </span>
            </Link>
          </div>
        </div>
        <div className="mt-3 border-t border-bd-subtle pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-fg-dim">Session coverage</span>
            <span className={clsx("text-xs font-medium", snapshotTone)}>{snapshotLabel}</span>
          </div>
          <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain lg:block lg:space-y-1.5 lg:overflow-visible">
            <div className="min-w-[8.5rem] rounded-md border border-bd-subtle bg-bg px-2.5 py-2 lg:min-w-0" title={`${fmtNumFull(retainedSessions)} parsed session summaries are retained in Collection.`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-fg-muted">Saved summaries</span>
                <span className="mono text-[12px] font-semibold tabular-nums text-fg">{fmtNum(retainedSessions)}</span>
              </div>
              <div className="mt-0.5 text-xs text-fg-dim">parsed summaries{archivedSessions > 0 ? ` · ${fmtNum(archivedSessions)} archived` : ""}</div>
            </div>
            <Link
              href="/collection/timeline"
              className="block min-w-[8.5rem] rounded-md border border-bd-subtle bg-bg px-2.5 py-2 transition-colors hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:min-w-0"
              title="Timeline owns outcome signals, comparable windows, and their denominator."
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-fg-muted">Outcomes</span>
                <span className="text-xs font-medium text-accent-soft">Timeline <span aria-hidden="true">→</span></span>
              </div>
              <div className="mt-0.5 text-xs text-fg-dim">Compare in Timeline</div>
            </Link>
            <div className="min-w-[8.5rem] rounded-md border border-bd-subtle bg-bg px-2.5 py-2 lg:min-w-0" title={`${fmtNumFull(staleSessions)} parsed sessions last emitted an event more than 12 hours ago. Historical sessions are expected in the archive and are not parser failures.`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-fg-muted">Last active over 12h ago</span>
                <span className={clsx("mono text-[12px] font-semibold tabular-nums", "text-fg")}>{fmtNum(staleSessions)}</span>
              </div>
              <div className="mt-0.5 text-xs text-fg-dim">Historical sessions are retained</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function CollectionClient({ initialData, error, initialQuery, rollup }: { initialData: AllSourcesResult; error?: string; initialQuery?: string; rollup?: RollupReport }) {
  const { setSelection: setChartSelection } = useChartSelection();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(error);
  const [q, setQ] = useState(initialQuery ?? "");
  const [hits, setHits] = useState<FtsHit[] | null>(null);
  const [sessionSort, setSessionSort] = useState<SessionSort>("recent");
  const [harnessFilter, setHarnessFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [allModelColumns, setAllModelColumns] = useState(false);
  const [inspectedModel, setInspectedModel] = useState<string | null>(null);
  const [modelSort, setModelSort] = useState<ModelSort>("cost");
  const [modelQuery, setModelQuery] = useState("");
  // Exhaustion is cursor-driven: the API returns nextCursor=null once the
  // listable window (snapshot cap, retention) is walked, even while
  // totalParsedSessions is larger. `undefined` = no cursor yet (server-rendered
  // initial data) — the first load-more bootstraps one via a full ?limit= fetch.
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  // Identities appended by the most recent "Load more" — rows carrying one get the
  // opacity-only entrance animation; the set clears shortly after so later re-renders
  // (sorts, filter changes) never re-animate rows that are no longer new.
  const newBatchIdsRef = useRef<Set<string>>(new Set());
  const ranInitial = useRef(false);
  // Last query actually sent — the debounce effect only fires on real changes.
  const lastSearched = useRef(initialQuery?.trim() ?? "");
  // Monotonic request id: responses that lost the race are dropped, so hits
  // always match the newest query (and a cleared box can't resurrect results).
  const searchSeq = useRef(0);

  // A ?q= handoff (e.g. from the dashboard search box) runs immediately.
  useEffect(() => {
    if (initialQuery && !ranInitial.current) {
      ranInitial.current = true;
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  const [searching, setSearching] = useState(false);

  // Debounced search-as-you-type: no submit needed; the query is mirrored into
  // `?q=` so a found search survives reload and can be shared. The guard is
  // re-checked when the timer fires so a manual submit inside the debounce
  // window doesn't double-fire the same search.
  useEffect(() => {
    const query = q.trim();
    if (query === lastSearched.current) return;
    const t = setTimeout(() => {
      if (query !== lastSearched.current) void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const [indexInfo, setIndexInfo] = useState<{ indexedFiles: number; totalFiles: number } | null>(null);
  const [indexing, setIndexing] = useState(false);

  // Harvest corpus spans BOTH the session list and any search hits — hits come
  // from the full-history FTS index, whose sessions may predate the recent list.
  const harvestFrom = useMemo(
    () => [
      ...data.sessions.flatMap((s) => [s.project, s.path, s.model]),
      ...(hits ?? []).flatMap((h) => [h.project, h.file]),
    ],
    [data.sessions, hits],
  );
  const { redact, setRedact, show } = useRedactedShow(harvestFrom);

  async function runSearch(rawQuery: string) {
    const query = rawQuery.trim();
    const seq = ++searchSeq.current; // also invalidates any in-flight response
    if (!query) {
      lastSearched.current = "";
      syncQueryUrl("");
      setHits(null);
      setSearching(false);
      return;
    }
    lastSearched.current = query;
    syncQueryUrl(query);
    setSearching(true);
    try {
      const res = await fetch(`/api/collection/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (seq !== searchSeq.current) return; // a newer search superseded this one
      setHits(d.hits);
      setIndexInfo(d.index);
      setErr(undefined);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      lastSearched.current = ""; // failed — let the debounce retry the same query
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  async function buildIndex() {
    setIndexing(true);
    try {
      let remaining = 1;
      while (remaining > 0) {
        const res = await fetch("/api/collection/search/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max: 25 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        remaining = d.remaining;
        setIndexInfo({ indexedFiles: d.total - d.remaining, totalFiles: d.total });
      }
      if (q.trim()) await runSearch(q);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  async function fetchCollection(limit: number, busy: (v: boolean) => void): Promise<CollectionPayload | null> {
    busy(true);
    try {
      const res = await fetch(`/api/collection?limit=${Math.min(MAX_LIMIT, Math.max(1, limit))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as CollectionPayload;
      setData(next);
      setNextCursor(next.nextCursor ?? null);
      setErr(next.refreshError);
      return next;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      busy(false);
    }
  }

  // Rescan keeps however many rows are already loaded instead of snapping back
  // to 80; the full-replace response also resets the continuation cursor.
  async function refresh() {
    await fetchCollection(Math.max(80, data.sessions.length), setLoading);
  }

  // Stale-while-revalidate intentionally serves the last complete snapshot
  // immediately. Follow that background refresh so the amber banner clears
  // itself instead of asking the user to press Rescan after the work finished.
  useEffect(() => {
    if (!data.refreshing || loading || err) return;
    const timer = window.setTimeout(() => {
      void fetchCollection(Math.max(80, data.sessions.length), () => {});
    }, 2_000);
    return () => window.clearTimeout(timer);
    // fetchCollection is a component-local request helper; the snapshot fields
    // below are the retry state machine's complete inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.refreshing, data.generatedAtMs, data.sessions.length, loading, err]);

  async function loadMore() {
    if (loading || loadingMore || nextCursor === null) return;
    // No cursor yet (initial data came from the server render): one full
    // ?limit= fetch replaces the list and yields a cursor for later pages.
    if (nextCursor === undefined) {
      await fetchCollection(data.sessions.length + LOAD_STEP, setLoadingMore);
      return;
    }
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/collection?cursor=${encodeURIComponent(nextCursor)}&page=${LOAD_STEP}`);
      if (res.status === 409) {
        // The corpus reordered between pages. Restart from one atomic snapshot
        // instead of appending a page that could skip or duplicate sessions.
        await fetchCollection(Math.max(80, data.sessions.length), () => {});
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as CursorPage;
      setData((prev) => {
        // The vanished-cursor fallback can overlap already-loaded rows — dedupe
        // on the same identity the row keys use.
        const seen = new Set(prev.sessions.map(collectionSessionIdentity));
        const added = page.sessions.filter((s) => !seen.has(collectionSessionIdentity(s)));
        newBatchIdsRef.current = new Set(added.map(collectionSessionIdentity));
        return {
          ...prev,
          sessions: [...prev.sessions, ...added],
          totalParsedSessions: page.totalParsedSessions,
          generatedAtMs: page.generatedAtMs,
          stale: page.stale,
          refreshing: page.refreshing,
          refreshError: page.refreshError,
        };
      });
      setNextCursor(page.nextCursor);
      setErr(page.refreshError);
      window.setTimeout(() => { newBatchIdsRef.current = new Set(); }, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const models = useMemo(() => data.byModel ?? [], [data.byModel]);
  const [showAllModels, setShowAllModels] = useState(false);
  const modelMeasure = (model: typeof models[number]) => measureModel(model, modelSort);
  const modelMetricLabel = { cost: "API-equivalent estimate", sessions: "sessions", tokens: "I/O tokens", cache: "cache reads", tools: "tool calls", errors: "tool error rate" }[modelSort];
  const tools = data.byTool ?? [];
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    const list = query ? models.filter((model) => model.model.toLowerCase().includes(query)) : [...models];
    list.sort((a, b) => {
      switch (modelSort) {
        case "sessions": return b.sessions - a.sessions || b.costUsd - a.costUsd;
        case "tokens": return (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens);
        case "cache": return b.cacheReadTokens - a.cacheReadTokens;
        case "tools": return b.toolCalls - a.toolCalls || b.toolErrors - a.toolErrors;
        case "errors": {
          const bRate = b.toolCalls > 0 ? b.toolErrors / b.toolCalls : 0;
          const aRate = a.toolCalls > 0 ? a.toolErrors / a.toolCalls : 0;
          return bRate - aRate || b.toolErrors - a.toolErrors;
        }
        default: return b.costUsd - a.costUsd || b.sessions - a.sessions;
      }
    });
    // Cap the table at 12 rows unless the reader expands or is filtering — an
    // uncapped table made this section 4,500px tall and pushed every later
    // section below the fold.
    if (!showAllModels && !query) return list.slice(0, 12);
    return list;
  }, [models, modelQuery, modelSort, showAllModels]);

  const harnessOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const source of data.sources) {
      // Keep filters useful for sources represented by aggregate/archive data
      // even when their rows are outside the currently loaded page.
      if (source.status !== "absent") seen.set(source.id, source.label);
    }
    for (const s of data.sessions) if (!seen.has(s.sourceId)) seen.set(s.sourceId, s.sourceLabel);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.sources, data.sessions]);

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const model of models) seen.add(model.model);
    for (const s of data.sessions) seen.add(s.model ?? "unknown");
    return [...seen].sort();
  }, [data.sessions, models]);

  const visibleSessions = useMemo(() => {
    let list = data.sessions;
    if (harnessFilter !== "all") list = list.filter((s) => s.sourceId === harnessFilter);
    if (modelFilter !== "all") list = list.filter((s) => (s.model ?? "unknown") === modelFilter);
    // The payload already arrives sorted by lastEventAt desc, so "recent"
    // needs no re-sort (and no copy — the branches below never mutate `list`).
    if (sessionSort === "recent") return list;
    const sorted = [...list];
    switch (sessionSort) {
      case "tokens":
        sorted.sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
        break;
      case "duration":
        sorted.sort((a, b) => b.durationMs - a.durationMs);
        break;
      default:
        sorted.sort((a, b) => b.toolCalls - a.toolCalls || b.toolErrors - a.toolErrors);
    }
    return sorted;
  }, [data.sessions, harnessFilter, modelFilter, sessionSort]);

  const sessionsFiltered = harnessFilter !== "all" || modelFilter !== "all";
  // undefined (no cursor yet) still offers Load more — only an explicit null is exhausted.
  const moreAvailable = nextCursor !== null && data.sessions.length < data.totalParsedSessions;
  const loadedLabel = `${fmtNumFull(data.sessions.length)} of ${fmtNumFull(data.totalParsedSessions)} loaded`;
  const hm = rollup?.heatmap ?? [];
  const hasHeatmap = hm.some((row) => row.some((v) => v > 0));
  const hasWeekly = !!rollup && rollup.weekly.some((w) => w.sessions > 0);
  const hasModels = models.length > 0;
  const hasTools = tools.length > 0;

  const sections = useMemo(() => [
    { id: "overview", label: "Start here", description: "Corpus size, estimated API cost, work volume, and transcript search." },
    ...(hasModels ? [{ id: "models", label: "Model mix", description: "Compare model use, tokens, estimated cost, and errors." }] : []),
    { id: "fidelity", label: "Evidence quality", description: "Check coverage, storage limits, and how totals were built." },
    { id: "analysis", label: "Explore evidence", description: "Filter the full population and inspect matching sessions." },
    ...(hasWeekly ? [{ id: "usage", label: "Spend & usage", description: "Track sessions, tokens, and estimated API cost over time." }] : []),
    ...(hasHeatmap ? [{ id: "rhythm", label: "When you work", description: "See when sessions start across the week and day." }] : []),

    ...(hasTools ? [{ id: "tools", label: "Tool health", description: "See which tools run most and where they fail." }] : []),
    { id: "harnesses", label: "Sources", description: "Check which harnesses were found, parsed, or archived." },
    { id: "sessions", label: "Find a session", description: "Search and open retained transcript summaries." },
  ], [hasWeekly, hasHeatmap, hasModels, hasTools]);
  const { activeSection, selectSection, isVisible } = useProgressiveSection(sections, "all");
  const exploreAnalysis = (selection: ChartSelection) => {
    setChartSelection(selection);
    selectSection("analysis");
  };

  // A search handoff is a direct request to find evidence. Move the user to
  // the session catalog once results arrive instead of leaving them at the
  // overview panel while the query runs in the background.
  useEffect(() => {
    if (q.trim() && hits !== null) selectSection("sessions");
  }, [hits, q, selectSection]);

  const ioTokens = data.totalInputTokens + data.totalOutputTokens;
  const cacheRead = data.totalCacheReadTokens ?? 0;
  const cacheMult = ioTokens > 0 ? cacheRead / ioTokens : 0;
  const toolErrTotal = models.reduce((a, m) => a + m.toolErrors, 0);
  const toolErrPct = data.totalToolCalls > 0 ? (toolErrTotal / data.totalToolCalls) * 100 : 0;
  const pricingCoverage = data.totalParsedSessions > 0 ? data.totalPricedSessions / data.totalParsedSessions : 0;
  const tilde = data.anyEstimatedCost ? "~" : "";

  // These fields were added after the first Collection payload shipped. Keep
  // the UI useful during a hot reload or when a client has an older payload;
  // file inventory and parsed-session provenance remain separate by design.
  const parseableFiles = data.totalParseableFiles ?? data.sources.reduce((n, s) => n + (s.parseable ? s.filesFound : 0), 0);
  const detectOnlyFiles = data.totalDetectOnlyFiles ?? data.sources.reduce((n, s) => n + (!s.parseable ? s.filesFound : 0), 0);
  const measuredUsageSessions = data.totalMeasuredUsageSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithMeasuredUsage ?? 0), 0);
  const measuredDurationSessions = data.totalMeasuredDurationSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithMeasuredDuration ?? 0), 0);
  const inferredDurationSessions = data.totalInferredDurationSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithInferredDuration ?? 0), 0);
  const subagentSessions = data.totalSubagentSessions ?? data.sources.reduce((n, s) => n + (s.subagentSessions ?? 0), 0);
  const measuredModelSessions = data.totalMeasuredModelSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithMeasuredModel ?? 0), 0);
  const missingModelSessions = data.totalMissingModelSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithMissingModel ?? 0), 0);
  const inferredModelSessions = data.totalInferredModelSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithInferredModel ?? 0), 0);
  const missingTokenSessions = data.totalMissingTokenSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithMissingTokens ?? 0), 0);
  const inferredCostSessions = data.totalInferredCostSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithInferredCost ?? 0), 0);
  const malformedLineSessions = data.totalMalformedLineSessions ?? data.sources.reduce((n, s) => n + (s.sessionsWithMalformedLines ?? 0), 0);
  const staleSessions = data.totalStaleSessions ?? data.sources.reduce((n, s) => n + (s.staleSessions ?? 0), 0);
  const parseWarningCounts = data.parseWarningCounts ?? {
    sessionsWithWarnings: 0,
    missingEvidence: 0,
    inferredEvidence: 0,
    incompleteTrace: 0,
    malformedInput: 0,
    runtimeErrors: 0,
    mixedModels: 0,
    other: 0,
  };
  const partialSourceLabels = (data.partialSources ?? [])
    .map((id) => data.sources.find((s) => s.id === id)?.label ?? id)
    .join(", ");
  const inventoryPartialSourceLabels = (data.inventoryPartialSources ?? [])
    .map((id) => data.sources.find((s) => s.id === id)?.label ?? id)
    .join(", ");
  const coveragePartialSourceLabels = (data.coveragePartialSources ?? [])
    .map((id) => data.sources.find((s) => s.id === id)?.label ?? id)
    .join(", ");

  let busiest: { d: number; h: number; v: number } | null = null;
  for (let d = 0; d < hm.length; d++) {
    for (let h = 0; h < 24; h++) {
      if (!busiest || hm[d][h] > busiest.v) busiest = { d, h, v: hm[d][h] };
    }
  }

  const totalModelCost = models.reduce((a, m) => a + m.costUsd, 0);
  const topCostModel = models.reduce<(typeof models)[number] | null>((best, model) => !best || model.costUsd > best.costUsd ? model : best, null);
  const topSessionModel = models.reduce<(typeof models)[number] | null>((best, model) => !best || model.sessions > best.sessions ? model : best, null);
  const topErrorModel = models
    .filter((model) => model.toolCalls >= 10)
    .reduce<(typeof models)[number] | null>((best, model) => {
      if (!best) return model;
      return model.toolErrors / model.toolCalls > best.toolErrors / best.toolCalls ? model : best;
    }, null);

  return (
    <div className="min-w-0 p-4 md:p-6 w-full">
      <PageHeader
        icon={Boxes}
        title="Collection"
        subtitle="Explore local sessions, compare usage, and open the conversation behind each result."
        actions={
          <>
            <ScannedAgo generatedAtMs={data.generatedAtMs} />
            <RedactToggle redact={redact} onToggle={() => setRedact((v) => !v)} compact />
            <Link
              href="/collection/timeline"
              className="flex min-h-10 items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Activity className="size-3.5" /> Timeline &amp; comparisons
            </Link>
            <button
              onClick={refresh}
              disabled={loading || loadingMore}
              className="flex min-h-10 items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} /> Rescan
            </button>
          </>
        }
      />

      <div className="min-w-0 max-w-full lg:hidden">
        <ProgressiveSectionNav
          sections={sections}
          activeSection={activeSection}
          onSelect={selectSection}
          summary={`${fmtNum(data.totalParsedSessions)} sessions · ${tilde}${fmtUsd(data.totalCostUsd)} API eq.`}
        />
      </div>

      <div className="grid min-w-0 max-w-full gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <EvidenceRail
          activeSection={activeSection}
          onSelect={selectSection}
          retainedSessions={data.totalParsedSessions}
          archivedSessions={data.totalArchivedSessions}
          staleSessions={staleSessions}
          refreshing={Boolean(data.stale || data.refreshing)}
          hasError={Boolean(err)}
          hasCoverageCaveat={Boolean(data.partial || data.inventoryPartial || data.coveragePartial)}
        />
        <main className="min-w-0 max-w-full">

      {err && (
        <div className="mb-4 rounded-lg border border-err/40 bg-err/10 p-3 flex items-start gap-2.5" role="alert">
          <AlertTriangle className="size-4 text-err shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-err">Collection scan failed</div>
            <div className="text-[12px] text-fg-muted mt-0.5 break-words">
              {err} The report may be stale; an empty or missing result is unavailable evidence, not proof of zero activity. Use Rescan to try again.
            </div>
          </div>
        </div>
      )}
      {!err && (data.stale || data.refreshing) && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 flex items-start gap-2.5" role="status">
          <AlertTriangle className="size-4 text-warn shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-warn">Refreshing Collection</div>
            <div className="text-xs text-fg-muted mt-0.5">
              The last complete scan stays visible while a new snapshot is built.
            </div>
          </div>
        </div>
      )}

      {(data.partial || data.inventoryPartial || data.coveragePartial) && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 flex items-start gap-2.5" role={data.partial ? "alert" : "status"}>
          <AlertTriangle className="size-4 text-warn shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-warn">Some collection evidence is unavailable</div>
            <p className="text-[12px] text-fg-muted mt-0.5">Totals include readable evidence only. Missing files or fields may leave gaps in this report.</p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-fg-muted">
              {data.partial && <li>Scan stopped early; older files were not parsed in this pass{partialSourceLabels ? ` (${partialSourceLabels})` : ""}. Use Rescan to continue.</li>}
              {data.inventoryPartial && <li>The file count may be incomplete{inventoryPartialSourceLabels ? ` for ${inventoryPartialSourceLabels}` : ""}; some files may not have been discovered.</li>}
              {data.coveragePartial && <li>Some discovered transcript files could not be included in parsed totals{coveragePartialSourceLabels ? ` for ${coveragePartialSourceLabels}` : ""}. Check Sources for format support and parsing notes.</li>}
            </ul>
          </div>
        </div>
      )}

      {isVisible("overview") && <section id="overview" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
        <div className="stagger-grid grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatGroup icon={Layers} label="Inventory">
            <StatCell
              featured
              label="Sessions"
              value={fmtNum(data.totalParsedSessions)}
              title={fmtNumFull(data.totalParsedSessions)}
              sub={subagentSessions > 0 ? `${fmtNum(subagentSessions)} child traces` : data.totalArchivedSessions > 0 ? `incl. ${fmtNum(data.totalArchivedSessions)} archived` : undefined}
            />
            <StatCell label="Sources" value={String(data.presentSources)} sub={`of ${data.sources.length} known`} />
            <StatCell label="Files" value={fmtNum(data.totalFiles)} title={`${fmtNumFull(data.totalFiles)} session files on disk`} sub="on-disk inventory" />
          </StatGroup>

          <StatGroup icon={Coins} label="API-equivalent estimate" tone="estimate">
            <StatCell
              featured
              label="At published API rates"
              value={tilde + fmtUsd(data.totalCostUsd)}
              title={`${fmtUsdFull(data.totalCostUsd)} API-equivalent estimate from recorded token classes and ${data.pricingSource} rates checked ${data.pricingListDate}. Not actual subscription/provider spend. Aggregate estimates exclude request-level long-context surcharges when the transcript does not preserve enough threshold evidence.`}
              sub={`${(pricingCoverage * 100).toFixed(0)}% coverage · ${fmtNum(data.totalPricedSessions)} priced`}
            />
            <StatCell
              label="Input + output"
              value={fmtNum(ioTokens)}
              title={`${fmtNumFull(ioTokens)} input + output usage reported across model calls. This is processed usage, not unique text; separately reported cache reads are excluded.`}
              sub={`↑${fmtNum(data.totalInputTokens)} ↓${fmtNum(data.totalOutputTokens)}`}
            />
            <StatCell
              label="Cache read"
              value={fmtNum(cacheRead)}
              title={`${fmtNumFull(cacheRead)} cache-read tokens — context re-read across turns (billed at cache rates), plus ${fmtNumFull(data.totalCacheCreateTokens ?? 0)} written to cache`}
              sub={cacheMult > 0 ? `${cacheMult.toFixed(1)}× input+output` : undefined}
            />
          </StatGroup>

          <StatGroup icon={Hammer} label="Tool activity" tone="activity">
            <StatCell featured label="Tool calls" value={fmtNum(data.totalToolCalls)} title={`${fmtNumFull(data.totalToolCalls)} tool calls`} sub="tool invocations" />
            <StatCell
              label="Errors"
              value={data.totalToolCalls > 0 ? `${toolErrPct.toFixed(1)}%` : "—"}
              tone={toolErrPct >= 5 ? "text-err" : undefined}
              title={`${fmtNumFull(toolErrTotal)} failed calls of ${fmtNumFull(data.totalToolCalls)}`}
              sub={toolErrTotal > 0 ? `${fmtNum(toolErrTotal)} failed` : undefined}
            />
            <StatCell
              label="Peak hour"
              value={busiest && busiest.v > 0 ? `${DAYS[busiest.d]} ${String(busiest.h).padStart(2, "0")}:00` : "—"}
              sub={busiest && busiest.v > 0 ? `${fmtNum(busiest.v)} sessions` : undefined}
            />
          </StatGroup>
        </div>
      </section>}

      {hasModels && isVisible("models") && (
        <section id="models" className={clsx("model-explorer scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
          <SectionHeader
            icon={Cpu}
            title="Models"
            desc="Compare all-time model usage. Select a model to inspect its activity and conversations."
            right={`${models.length} models · ${tilde}${fmtUsd(totalModelCost)} API eq.`}
          />
          <div className="card min-w-0 overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-bd-subtle border-b border-bd-subtle sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="min-w-0 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Highest API equivalent</div>
                <button type="button" disabled={!topCostModel} className="mt-1 text-left break-all text-sm font-medium mono hover:text-accent-soft min-h-10" onClick={() => topCostModel && setInspectedModel(topCostModel.model)}>{topCostModel ? show(topCostModel.model) : "—"}</button>
                <div className="mt-1 text-lg font-semibold mono tabular-nums">{topCostModel ? `${topCostModel.listedRateSessions + topCostModel.familyRateSessions + topCostModel.fallbackRateSessions + topCostModel.allocatedCostSessions > 0 ? "~" : ""}${fmtUsd(topCostModel.costUsd)}` : "—"}</div>
              </div>
              <div className="min-w-0 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Most sessions</div>
                <button type="button" disabled={!topSessionModel} className="mt-1 text-left break-all text-sm font-medium mono hover:text-accent-soft min-h-10" onClick={() => topSessionModel && setInspectedModel(topSessionModel.model)}>{topSessionModel ? show(topSessionModel.model) : "—"}</button>
                <div className="mt-1 text-lg font-semibold mono tabular-nums">{topSessionModel ? fmtNum(topSessionModel.sessions) : "—"} <span className="text-[10px] font-normal text-fg-dim">sessions</span></div>
              </div>
              <div className="min-w-0 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Highest tool error rate</div>
                <button type="button" disabled={!topErrorModel} className="mt-1 text-left break-all text-sm font-medium mono hover:text-accent-soft min-h-10" onClick={() => topErrorModel && setInspectedModel(topErrorModel.model)}>{topErrorModel ? show(topErrorModel.model) : "—"}</button>
                <div className={clsx("mt-1 text-lg font-semibold mono tabular-nums", topErrorModel && topErrorModel.toolErrors / topErrorModel.toolCalls >= 0.05 ? "text-err" : undefined)}>
                  {topErrorModel ? `${((topErrorModel.toolErrors / topErrorModel.toolCalls) * 100).toFixed(1)}%` : "—"} <span className="text-[10px] font-normal text-fg-dim">{topErrorModel ? `${fmtNumFull(topErrorModel.toolErrors)} / ${fmtNumFull(topErrorModel.toolCalls)} calls · minimum 10` : "minimum 10 calls"}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-bd-subtle px-3 py-2">
              <label className="flex min-h-10 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-bd bg-bg px-3 text-xs text-fg-muted focus-within:border-accent/70">
                <Search className="size-3.5 shrink-0" />
                <input
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="Find a model"
                  aria-label="Find a model"
                  className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-dim"
                />
                {modelQuery && (
                  <button type="button" onClick={() => setModelQuery("")} className="min-h-8 rounded px-2 py-1 text-[10px] text-fg-dim hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Clear model search">
                    Clear
                  </button>
                )}
              </label>
              <SelectPill
                icon={ArrowDownWideNarrow}
                value={modelSort}
                onChange={(value) => setModelSort(value as ModelSort)}
                options={[
                  ["cost", "API equivalent"],
                  ["sessions", "Sessions"],
                  ["tokens", "I/O tokens"],
                  ["cache", "Cache reads"],
                  ["tools", "Tool calls"],
                  ["errors", "Tool error rate"],
                ]}
              />
              <span className="ml-auto text-[10px] text-fg-dim mono tabular-nums" aria-live="polite">{fmtNum(visibleModels.length)} of {fmtNum(models.length)} models</span>
            </div>
            <button type="button" className="analysis-control model-columns-toggle m-3" aria-pressed={allModelColumns} onClick={() => setAllModelColumns(v => !v)}>{allModelColumns ? "Compact columns" : "All columns"}</button>
            {inspectedModel && <ModelInspection key={inspectedModel} model={inspectedModel} onClose={() => setInspectedModel(null)} onExplore={exploreAnalysis} />}
            <div className="chart-scroll-well overflow-x-auto pb-2">
              <table className={clsx("data-table model-explorer-table min-w-[840px]", allModelColumns && "model-all-columns")} aria-label="Model usage and pricing evidence">
                <thead>
                  <tr>
                    <th scope="col" className={STICKY_TH}>Model</th><th scope="col" className="model-mobile-metric num">{modelMetricLabel}</th>
                    <th scope="col" className="num">Sessions</th>
                    <th scope="col" className="num">I/O tokens</th>
                    <th scope="col" className="num">Cache reads</th>
                    <th scope="col" className="num">Tool calls</th>
                    <th scope="col" className="num">Tool error rate</th>
                    <th scope="col" className="num">API equiv.</th>
                    <th scope="col" className="num">{modelSort === "errors" ? "Error rate" : "Share"}</th>
                    <th scope="col">Explore</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleModels.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-fg-dim">
                        No models match “{modelQuery}”.{" "}
                        <button type="button" onClick={() => setModelQuery("")} className="text-accent-soft underline underline-offset-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">
                          Clear search
                        </button>
                      </td>
                    </tr>
                  )}
                  {visibleModels.map((m) => {
                    const errPct = m.toolCalls ? (m.toolErrors / m.toolCalls) * 100 : 0;
                    const share = modelBarFraction(m, models, modelSort);
                    const modelCostEstimated = m.listedRateSessions + m.familyRateSessions + m.fallbackRateSessions + m.allocatedCostSessions > 0;
                    return (
                      <tr key={m.model} className="cv-auto">
                        <th scope="row" className={clsx("max-w-[240px] px-3 py-2 text-left font-normal mono text-[11px]", STICKY_TD)}>
                          <button type="button" className="model-name text-left break-all text-sm min-h-10 hover:text-accent-soft" aria-pressed={inspectedModel === m.model} onClick={() => setInspectedModel(m.model)}>{m.model === "unknown" ? "Unknown model" : show(m.model)}</button>
                          <PricingEvidence model={m} />
                        </th>
                        <td className="model-mobile-metric num">{modelSort === "cost" ? (m.costUsd > 0 || m.pricedSessions > 0 ? (modelCostEstimated ? "~" : "") + fmtUsd(m.costUsd) : "—") : modelSort === "errors" ? (m.toolCalls ? `${(modelMeasure(m) * 100).toFixed(1)}%` : "—") : fmtNum(modelMeasure(m))}</td>
                        <td className="num" title={`${fmtNumFull(m.pricedSessions)} priced · ${fmtNumFull(m.inferredModelSessions)} inferred model ids`}>{fmtNum(m.sessions)}</td>
                        <td className="num text-fg-muted" title={`${fmtNumFull(m.inputTokens + m.outputTokens)} input + output — ↑${fmtNum(m.inputTokens)} ↓${fmtNum(m.outputTokens)}; processed usage, not unique text`}>
                          {fmtNum(m.inputTokens + m.outputTokens)}
                          <span className="sr-only">{fmtNumFull(m.inputTokens + m.outputTokens)} input + output tokens</span>
                        </td>
                        <td className="num text-fg-dim" title={fmtNumFull(m.cacheReadTokens)}>{fmtNum(m.cacheReadTokens)}</td>
                        <td className="num text-fg-muted">{fmtNum(m.toolCalls)}</td>
                        <td className={clsx("num", errPct >= 5 ? "text-err" : "text-fg-dim")}>{m.toolCalls ? `${errPct.toFixed(1)}%` : "—"}</td>
                        <td className="num" title={`${fmtUsdFull(m.costUsd)} API-equivalent estimate · ${fmtNumFull(m.pricedSessions)}/${fmtNumFull(m.sessions)} sessions priced · ${fmtNumFull(m.measuredCostSessions)} recorded, ${fmtNumFull(m.allocatedCostSessions)} allocated, ${fmtNumFull(m.listedRateSessions)} listed, ${fmtNumFull(m.familyRateSessions)} family-mapped, ${fmtNumFull(m.fallbackRateSessions)} fallback · not actual spend`}>
                          {/* A listed $0 (free tier) is a real price, not missing data — show ~$0. */}
                          {m.costUsd > 0 || m.pricedSessions > 0
                            ? (modelCostEstimated ? "~" : "") + fmtUsd(m.costUsd)
                            : "—"}
                          <span className="sr-only">{fmtUsdFull(m.costUsd)} API-equivalent estimate, not actual spend</span>
                        </td>
                        <td className="num">{modelSort === "cost" && !m.pricedSessions ? <span className="text-fg-dim">Unavailable</span> : <ShareBar frac={share} />}</td>
                        <td>
                          <button type="button" className="analysis-control min-h-8 px-2 py-1 text-[10px]" onClick={() => exploreAnalysis({ model: m.model })}>Explore</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {models.length > 12 && !modelQuery && (
              <div className="px-4 py-2 border-t border-bd-subtle text-center">
                <button
                  type="button"
                  onClick={() => setShowAllModels((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-bd px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-expanded={showAllModels}
                >
                  {showAllModels ? `Show fewer (top 12 of ${models.length})` : `Show all ${models.length} models`}
                </button>
              </div>
            )}
            <div className="px-3 py-1.5 border-t border-bd-subtle text-[10px] text-fg-dim">
              {modelSort === "errors" ? "Bars show failed calls divided by total calls for each model." : `Bars show each model’s share of all-time ${modelMetricLabel} across all ${models.length} models; search does not change that denominator. Mixed-model sessions count once for each model they contain.`} Input + output is processed usage, not unique text; cache reads are reported separately. Pricing evidence: {fmtNum(models.reduce((sum, model) => sum + model.allocatedCostSessions, 0))} allocated, {fmtNum(data.totalListedRateSessions)} listed-rate, {fmtNum(data.totalFamilyRateSessions)} family-mapped, {fmtNum(data.totalFallbackRateSessions)} fallback session estimates.
            </div>
          </div>
        </section>
      )}


      {isVisible("fidelity") && <section id="fidelity" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
        <SectionHeader
          icon={ShieldCheck}
          title="Evidence quality"
          desc="Recorded, estimated, and unavailable data across readable files"
          right={`${fmtNum(parseableFiles)} readable · ${fmtNum(detectOnlyFiles)} found only`}
        />
        <div className="card overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-y divide-bd-subtle">
            <StatCell
              label="Recorded tokens"
              value={data.totalParsedSessions > 0 ? `${fmtNum(measuredUsageSessions)}/${fmtNum(data.totalParsedSessions)}` : "—"}
              title={`${fmtNumFull(measuredUsageSessions)} of ${fmtNumFull(data.totalParsedSessions)} parsed sessions carry recorded token usage; missing-token sessions: ${fmtNumFull(missingTokenSessions)}.`}
              sub={missingTokenSessions > 0 ? `${fmtNum(missingTokenSessions)} missing` : "all parsed sessions"}
            />
            <StatCell
              label="Recorded duration"
              value={data.totalParsedSessions > 0 ? `${fmtNum(measuredDurationSessions)}/${fmtNum(data.totalParsedSessions)}` : "—"}
              title={`${fmtNumFull(measuredDurationSessions)} of ${fmtNumFull(data.totalParsedSessions)} parsed sessions carry recorded duration evidence.`}
              sub="session evidence"
            />
            <StatCell
              label="Missing model"
              value={fmtNum(missingModelSessions)}
              tone={missingModelSessions > 0 ? "text-warn" : undefined}
              title={`${fmtNumFull(missingModelSessions)} parsed sessions have no model identity in their trace.`}
              sub={inferredModelSessions > 0 ? `${fmtNum(inferredModelSessions)} inferred` : "none missing"}
            />
            <StatCell
              label="Estimated-cost sessions"
              value={fmtNum(inferredCostSessions)}
              title={`${fmtNumFull(inferredCostSessions)} parsed sessions use token/rate evidence rather than a recorded cost; ${fmtNumFull(data.totalMeasuredCostSessions)} have recorded cost.`}
              sub={`${fmtNum(data.totalMeasuredCostSessions)} recorded`}
            />
            <StatCell
              label="Malformed sessions"
              value={fmtNum(malformedLineSessions)}
              tone={malformedLineSessions > 0 ? "text-warn" : undefined}
              title={`${fmtNumFull(malformedLineSessions)} parsed sessions skipped one or more malformed lines.`}
              sub="parse health"
            />
            <StatCell
              label="Older than 12h"
              value={fmtNum(staleSessions)}
              title={`${fmtNumFull(staleSessions)} parsed sessions last emitted an event more than 12 hours ago. Historical sessions are expected in the archive and are not parser failures.`}
              sub="expected in archive"
            />
            <StatCell
              label="Readable files"
              value={fmtNum(parseableFiles)}
              title={`${fmtNumFull(parseableFiles)} on-disk files belong to sources OpenEval can read. This is an inventory count, not session coverage.`}
              sub="on disk"
            />
            <StatCell
              label="Found, not parsed"
              value={fmtNum(detectOnlyFiles)}
              title={`${fmtNumFull(detectOnlyFiles)} on-disk files were found but not parsed because their source format has no parser yet.`}
              sub="metrics unavailable"
            />
            <StatCell
              label="Avg quality"
              value={data.totalParsedSessions > 0 ? `${Math.round(data.sources.reduce((n, s) => n + (s.avgDataQuality * s.parsedSessions), 0) / Math.max(1, data.totalParsedSessions))}%` : "—"}
              title="Average data-quality score is weighted over parsed sessions; detect-only files are excluded."
              sub="parsed sessions only"
            />
          </div>
          <p className="px-3 py-2 border-t border-bd-subtle text-[10px] leading-relaxed text-fg-dim max-w-[85ch]">
            Recorded and estimated counts describe parsed sessions (including archived cache rows). Collection keeps one compact summary per transcript state and does not copy raw transcripts; unchanged scans are read-only. Optional full-text search stores bounded conversation excerpts so long sessions remain findable without unbounded cache growth.
          </p>
          <div className="grid grid-cols-1 gap-5 border-t border-bd-subtle p-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EvidenceComposition
                label="Model identity"
                total={data.totalParsedSessions}
                segments={[
                  { label: "Recorded", value: measuredModelSessions, tone: "measured" },
                  { label: "Estimated", value: inferredModelSessions, tone: "inferred" },
                  { label: "Not available", value: Math.max(0, data.totalParsedSessions - measuredModelSessions - inferredModelSessions), tone: "missing" },
                ]}
              />
              <EvidenceComposition
                label="Duration"
                total={data.totalParsedSessions}
                segments={[
                  { label: "Recorded", value: measuredDurationSessions, tone: "measured" },
                  { label: "Estimated", value: inferredDurationSessions, tone: "inferred" },
                  { label: "Not available", value: Math.max(0, data.totalParsedSessions - measuredDurationSessions - inferredDurationSessions), tone: "missing" },
                ]}
              />
              <EvidenceComposition
                label="Token usage"
                total={data.totalParsedSessions}
                segments={[
                  { label: "Recorded", value: measuredUsageSessions, tone: "measured" },
                  { label: "Not available", value: Math.max(0, data.totalParsedSessions - measuredUsageSessions), tone: "missing" },
                ]}
              />
              <EvidenceComposition
                label="Cost"
                total={data.totalParsedSessions}
                segments={[
                  { label: "Recorded", value: data.totalMeasuredCostSessions, tone: "measured" },
                  { label: "Estimated", value: inferredCostSessions, tone: "inferred" },
                  { label: "Not available", value: Math.max(0, data.totalParsedSessions - data.totalMeasuredCostSessions - inferredCostSessions), tone: "missing" },
                ]}
                note="Pricing coverage is not relabeled as measured cost."
              />
            </div>
            <div className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-medium text-fg">Parser warnings</span>
                <span className="mono text-[10px] tabular-nums text-fg-dim">{fmtNum(parseWarningCounts.sessionsWithWarnings)} sessions</span>
              </div>
              <div className="space-y-2.5">
                <EvidenceCoverageRow label="Missing evidence" value={parseWarningCounts.missingEvidence} total={data.totalParsedSessions} tone="missing" />
                <EvidenceCoverageRow label="Inferred evidence" value={parseWarningCounts.inferredEvidence} total={data.totalParsedSessions} tone="inferred" />
                <EvidenceCoverageRow label="Incomplete traces" value={parseWarningCounts.incompleteTrace} total={data.totalParsedSessions} tone="missing" />
                <EvidenceCoverageRow label="Malformed input" value={parseWarningCounts.malformedInput} total={data.totalParsedSessions} tone="missing" />
                <EvidenceCoverageRow label="Runtime errors" value={parseWarningCounts.runtimeErrors} total={data.totalParsedSessions} tone="missing" />
                <EvidenceCoverageRow label="Mixed models" value={parseWarningCounts.mixedModels} total={data.totalParsedSessions} tone="inferred" />
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-pretty text-fg-dim max-w-[85ch]">
                Categories may overlap within a session. Source labels such as harness and child-agent metadata are excluded from warnings.
              </p>
            </div>
          </div>
        </div>
      </section>}

      {isVisible("analysis") && (
        <section id="analysis" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
          <SectionHeader
            icon={BarChart3}
            title="Explore evidence"
            desc="Filter every matching parsed session, then hand off a bounded view to Timeline"
            right="full population"
          />
          <CollectionAnalysis />
        </section>
      )}

      {hasWeekly && rollup && isVisible("usage") && (
        <section id="usage" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
          <SectionHeader
            icon={TrendingUp}
            title="Usage"
            desc="Weekly volume, estimated API cost, and source mix across all harnesses"
            right={`${rollup.weekly.length}w window`}
          />
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
            <WeeklyUsageChart rollup={rollup} onExplore={exploreAnalysis} />
            <ProjectRanking
              projects={rollup.byProject}
              generatedAtMs={data.generatedAtMs}
              formatProject={(project) => compactDisplayPath(project, redact)}
            />
          </div>
        </section>
      )}

      {hasHeatmap && rollup && isVisible("rhythm") && (
        <section id="rhythm" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
          <SectionHeader
            icon={CalendarClock}
            title="Rhythm"
            desc="Session start times by weekday, hour, and day part"
            right={`${fmtNum(rollup.heatmapSessions ?? 0)} sessions`}
          />
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
            <ActivityHeatmap heatmap={hm} totalSessions={rollup.heatmapSessions ?? 0} onExplore={exploreAnalysis} />
            <RhythmPanel heatmap={hm} />
          </div>
        </section>
      )}

      {hasTools && isVisible("tools") && (
        <section id="tools" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
          <SectionHeader
            icon={Wrench}
            title="Tools"
            desc="Most-called tools across every harness, with failure rates"
            right={`${fmtNum(data.totalToolCalls)} calls`}
          />
          <ToolHealthList tools={tools} fullWidth hideHeading onExplore={exploreAnalysis} />
        </section>
      )}

      {isVisible("harnesses") && <section id="harnesses" className={clsx("scroll-mt-16 mb-6", sectionVisibilityClass(true))}>
        <SectionHeader
          icon={HardDrive}
          title="Harnesses"
          desc="Every known agent harness on this machine — present, empty, or absent"
          right={`${data.presentSources} present · ${data.sources.length} known`}
        />
        <div className="card min-w-0 overflow-hidden">
          <div className="chart-scroll-well overflow-x-auto pb-2">
            <table className="data-table min-w-[800px]" aria-label="Known agent harnesses on this machine">
              <thead>
                <tr>
                  <th className={STICKY_TH}>Harness</th>
                  <th>Status</th>
                  <th>Format</th>
                  <th className="num">Files</th>
                  <th className="num">Parsed</th>
                  <th className="num">I/O tokens</th>
                  <th className="num">API equiv.</th>
                  <th scope="col" className="num">Quality</th>
                  <th className="num">Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => {
                  const scanWarnings = s.scanWarnings ?? [];
                  const parsed = s.parsedSessions;
                  const sourceFidelityTitle = s.parseable
                    ? `${fmtNumFull(s.sessionsWithMeasuredUsage ?? 0)}/${fmtNumFull(parsed)} measured tokens · ${fmtNumFull(s.sessionsWithMeasuredDuration ?? 0)}/${fmtNumFull(parsed)} measured duration · ${fmtNumFull(s.sessionsWithMissingModel ?? 0)} missing model · ${fmtNumFull(s.sessionsWithInferredModel ?? 0)} inferred model · ${fmtNumFull(s.sessionsWithMissingTokens ?? 0)} missing tokens · ${fmtNumFull(s.sessionsWithInferredCost ?? 0)} inferred cost · ${fmtNumFull(s.sessionsWithMalformedLines ?? 0)} malformed sessions`
                    : `${fmtNumFull(s.filesFound)} detect-only files; this source is inventoried but not parsed into session metrics.${s.note ? ` ${s.note}` : ""}`;
                  return (
                  <tr key={s.id} className={clsx(s.status === "absent" && "opacity-45")}>
                    <td className={STICKY_TD}>
                      <div className="font-medium flex items-center gap-1.5">
                        {s.label}
                        {scanWarnings.length > 0 && (
                          <AlertTriangle className="size-3 text-warn shrink-0" aria-label="Scan warnings" role="img" />
                        )}
                      </div>
                      {!s.parseable && <div className="text-[10px] text-fg-dim flex items-center gap-1"><HelpCircle className="size-3" /> detect-only{s.note ? ` — ${s.note}` : ""}</div>}
                      {s.parseable && parsed > 0 && <div className="text-[10px] text-fg-dim truncate" title={sourceFidelityTitle}>{fmtNum(s.sessionsWithMeasuredUsage ?? 0)}/{fmtNum(parsed)} measured tokens · {fmtNum(s.sessionsWithInferredCost ?? 0)} inferred cost</div>}
                      <SourceCapabilities format={s.format} parseable={s.parseable} compact />
                    </td>
                    <td><StatusPill status={s.status} /></td>
                    <td className="text-[11px] text-fg-muted"><span className="mono">{s.format}</span></td>
                    <td className="num">{s.filesFound ? fmtNum(s.filesFound) : "—"}</td>
                    <td className="num" title={s.archivedSessions > 0 ? `${s.archivedSessions} archived (files pruned from disk; kept from the parse archive)` : undefined}>
                      {s.parseable ? <>{fmtNum(s.parsedSessions)}{s.archivedSessions > 0 && <span className="text-fg-dim text-[10px]"> incl. {fmtNum(s.archivedSessions)}a</span>}</> : <span className="text-fg-dim">n/a</span>}
                    </td>
                    <td className="num text-fg-muted" title={s.parseable && s.parsedSessions ? `${fmtNumFull(s.totalInputTokens + s.totalOutputTokens)} input + output · ${fmtNum(s.totalCacheReadTokens)} cache reads · processed usage, not unique text` : undefined}>{s.parseable && s.parsedSessions ? fmtNum(s.totalInputTokens + s.totalOutputTokens) : "—"}</td>
                    <td className="num text-fg-muted" title={s.parseable && s.totalCostUsd ? `${fmtUsdFull(s.totalCostUsd)} API-equivalent estimate · ${fmtNumFull(s.pricedSessions)}/${fmtNumFull(s.parsedSessions)} sessions priced · not actual spend` : undefined}>{s.parseable && s.totalCostUsd ? (s.costEstimated ? "~" : "") + fmtUsd(s.totalCostUsd) : "—"}</td>
                    <td
                      className={clsx("num", s.parseable && s.parsedSessions > 0 && s.avgDataQuality < 50 ? "text-warn" : "text-fg-dim")}
                      title={s.parseable && s.parsedSessions > 0 ? `Average data quality 0–100 — ${sourceFidelityTitle}${scanWarnings.length ? `\n${scanWarnings.join("\n")}` : ""}` : sourceFidelityTitle}
                    >
                      {s.parseable && s.parsedSessions > 0 ? Math.round(s.avgDataQuality) : "—"}
                    </td>
                    <td className="num text-fg-dim">{fmtRel(s.lastActivityMs, data.generatedAtMs)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {data.unknown.length > 0 && (
          <div className="card p-3 mt-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted mb-2 flex items-center gap-1.5">
              <HelpCircle className="size-3.5" /> Unknown transcript-like sources ({data.unknown.length})
            </div>
            <p className="text-[11px] text-fg-dim mb-2">Found transcript-shaped JSONL from a harness we don&apos;t recognize yet. Not parsed into metrics — add a registry entry to collect them accurately.</p>
            <div className="space-y-1">
              {data.unknown.map((u) => (
                <div key={u.dir} className="flex items-center justify-between text-[12px] mono">
                  <span className="text-fg-muted truncate" title={show(u.displayDir)}>{show(u.displayDir)}</span>
                  <span className="text-fg-dim shrink-0 ml-3 tabular-nums">{u.fileCount} jsonl</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>}

      {isVisible("sessions") && <section id="sessions" className={clsx("scroll-mt-16 mb-5", sectionVisibilityClass(true))}>
        <div id="find-session" className="card mb-4 min-w-0 p-3">
          <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg">Find a session</h2>
            <span className="text-[10px] text-fg-dim">Search retained transcript text across every harness.</span>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(q); }}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {searching
              ? <RefreshCw className="size-4 text-accent-soft shrink-0 animate-spin" aria-label="Searching" role="img" />
              : <Search className="size-4 text-fg-dim shrink-0" />}
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sessions and harnesses… (e.g. auth refactor)"
              aria-label="Search sessions"
              className="min-h-10 min-w-0 flex-1 basis-48 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-fg-dim"
            />
            <button
              type="submit"
              disabled={searching || !q.trim()}
              className="min-h-10 rounded-md border border-bd px-2.5 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {searching ? "Searching…" : "Search"}
            </button>
            {indexInfo && indexInfo.indexedFiles < indexInfo.totalFiles && (
              <button
                type="button"
                onClick={buildIndex}
                disabled={indexing}
                title="Reads transcripts and indexes their text for search. Incremental — only new/changed files are read."
                className="flex min-h-10 items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-sm text-warn hover:bg-bg-elev transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              >
                <DatabaseZap className={clsx("size-3.5", indexing && "animate-pulse")} />
                {indexing ? `Indexing ${indexInfo.indexedFiles}/${indexInfo.totalFiles}…` : `Index ${indexInfo.totalFiles - indexInfo.indexedFiles} files`}
              </button>
            )}
          </form>
          {hits !== null && (
            <div className="mt-3 border-t border-bd/50 pt-2">
              <p className="text-[11px] text-fg-dim mb-2 tabular-nums" aria-live="polite">
                {searching
                  ? "Searching…"
                  : hits.length === 0
                    ? "No matches"
                    : hits.length >= SEARCH_LIMIT
                      ? `First ${hits.length} results`
                      : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
                {lastSearched.current ? <> for <span className="text-fg-muted">&ldquo;{lastSearched.current}&rdquo;</span></> : null}
              </p>
              {indexInfo && indexInfo.indexedFiles < indexInfo.totalFiles && !indexing && (
                <p className="text-[11px] text-warn mb-2">Only {indexInfo.indexedFiles}/{indexInfo.totalFiles} files indexed — results may be incomplete.</p>
              )}
              {hits.length === 0 && <p className="text-sm text-fg-dim py-2">No matches. Try a shorter phrase or another term.</p>}
              <div className="space-y-1">
                {hits.map((h) => (
                  <SessionEvidenceLink
                    key={h.file}
                    href={`/collection/session?sourceId=${encodeURIComponent(h.sourceId)}&pathHint=${encodeURIComponent(h.file)}`}
                    className="block min-h-11 rounded-md px-2 py-2 -mx-2 hover:bg-bg-elev transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] shrink-0">{h.sourceId}</span>
                      <span className="truncate font-medium" title={show(h.title || h.file.split("/").pop())}>{show(h.title || h.file.split("/").pop())}</span>
                      <span className="text-[11px] text-fg-dim mono shrink-0 ml-auto tabular-nums">{fmtRel(h.at, data.generatedAtMs)}</span>
                    </div>
                    <div className="text-[12px] text-fg-muted mono mt-0.5 line-clamp-2">{show(h.snippet)}</div>
                    <div className="text-[10px] text-fg-dim truncate" title={compactDisplayPath(h.project, redact)}>{compactDisplayPath(h.project, redact)}</div>
                  </SessionEvidenceLink>
                ))}
              </div>
            </div>
          )}
        </div>
        <SectionHeader
          icon={History}
          title="Sessions"
          desc="Recent sessions across all harnesses. Open one to read its transcript."
          right={loadedLabel}
        />
        <div className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-bd-subtle px-3 py-2">
            <SelectPill
              icon={Filter}
              value={harnessFilter}
              onChange={setHarnessFilter}
              options={[["all", "All harnesses"], ...harnessOptions]}
            />
            <SelectPill
              icon={Cpu}
              value={modelFilter}
              onChange={setModelFilter}
              // Values stay raw (filter identity); labels follow table redaction.
              options={[["all", "All models"], ...modelOptions.map((m): [string, string] => [m, show(m)])]}
            />
            <SelectPill
              icon={ArrowDownWideNarrow}
              value={sessionSort}
              onChange={(v) => setSessionSort(v as SessionSort)}
              options={[["recent", "Recent"], ["tokens", "Tokens"], ["duration", "Duration"], ["tools", "Tool calls"]]}
            />
            <span className="ml-auto text-[11px] text-fg-dim tabular-nums">
              {sessionsFiltered ? `${fmtNumFull(visibleSessions.length)} match · ` : ""}{loadedLabel}
            </span>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="data-table min-w-[720px]" aria-label="Recent sessions across all harnesses">
              <thead>
                <tr>
                  <th scope="col" className={STICKY_TH}>Session</th>
                  <th scope="col">Model</th>
                  <th scope="col" className="num">Duration</th>
                  <th scope="col" className="num">Tokens</th>
                  <th scope="col" className="num">Tools</th>
                  <th scope="col" className="num">Quality</th>
                  <th scope="col" className="num">When</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-fg-dim text-sm">No parsed sessions found.</td></tr>
                )}
                {data.sessions.length > 0 && visibleSessions.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-fg-dim text-sm">No loaded sessions match the current filters.</td></tr>
                )}
                {visibleSessions.map((s) => {
                  const title = show(s.displayTitle || s.lastPromptPreview) || compactDisplayPath(s.project, redact);
                  const project = compactDisplayPath(s.project, redact);
                  return (
                    <tr key={collectionSessionIdentity(s)} data-new-batch={newBatchIdsRef.current.has(collectionSessionIdentity(s)) || undefined} className="cv-auto">
                      <td className={clsx(STICKY_TD, "min-w-[220px] max-w-[300px]")}>
                        {s.path ? (
                          <SessionEvidenceLink href={`/collection/session?sourceId=${encodeURIComponent(s.sourceId)}&sessionId=${encodeURIComponent(s.sessionId)}`} className="block group" title={title}>
                            <span className="block truncate text-[12px] text-fg group-hover:text-accent-soft group-hover:underline">{title}</span>
                            <span className="block truncate text-[10px] text-fg-dim">{project}</span>
                          </SessionEvidenceLink>
                        ) : (
                          <span className="block" title={title}>
                            <span className="block truncate text-[12px] text-fg-muted">{title}</span>
                            <span className="block truncate text-[10px] text-fg-dim">{project}</span>
                          </span>
                        )}
                        <SessionEvidenceLink href={`/collection/session?sourceId=${encodeURIComponent(s.sourceId)}&sessionId=${encodeURIComponent(s.sessionId)}`} className="mt-1 inline-flex text-[10px] text-accent-soft hover:underline">Inspect evidence</SessionEvidenceLink>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] whitespace-nowrap">{s.sourceLabel}</span>
                          {s.isSubagent && <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px]" title={s.parentSessionId ? `Child trace of ${s.parentSessionId}` : "Child-agent trace"}>child</span>}
                          {s.archived && <span className="rounded bg-bg-elev text-fg-dim px-1.5 py-0.5 text-[10px]" title="File pruned from disk; kept from the parse archive">archived</span>}
                        </div>
                        <EvidenceReview
                          className="mt-1"
                          identity={`${s.sourceId} / ${s.sessionId}`}
                          source={`${s.sourceLabel} (${s.sourceId})`}
                          provenance={s.archived ? "Archived summary" : s.path ? "From transcript" : "Summary without a retained path"}
                          transcript={s.path
                            ? {
                                status: s.archived ? "archived" : "available",
                                detail: s.archived
                                  ? "The summary remains available, but the source file may be gone."
                                  : "Open the source-qualified transcript on the detail page.",
                                href: `/collection/session?sourceId=${encodeURIComponent(s.sourceId)}&sessionId=${encodeURIComponent(s.sessionId)}`,
                                linkLabel: s.archived ? "Open archive status" : "Open transcript",
                              }
                            : {
                                status: "unavailable",
                                detail: "No transcript path is retained; use these metrics as summary evidence only.",
                              }}
                          caveats={[
                            s.archived ? "Full transcript text is gone when the source file has been pruned." : null,
                            s.isSubagent ? "Child traces are retained evidence and are excluded from Timeline outcome denominators." : null,
                            s.dataQuality < 50 ? `Data quality is ${Math.round(s.dataQuality)}/100; inspect the source before relying on derived metrics.` : null,
                            "This row shows summary metadata; raw transcript text loads on the detail page.",
                          ].filter((caveat): caveat is string => Boolean(caveat))}
                        />
                      </td>
                      <td className="mono text-[11px]">{s.model ? show(s.model) : <span className="text-fg-dim">unknown</span>}</td>
                      <td className="num text-fg-dim">{s.durationMs > 0 ? fmtDuration(s.durationMs) : "—"}</td>
                      <td className="num text-fg-muted" title={fmtNumFull(s.inputTokens + s.outputTokens)}>
                        {fmtNum(s.inputTokens + s.outputTokens)}
                        <span className="sr-only">{fmtNumFull(s.inputTokens + s.outputTokens)} input + output tokens</span>
                      </td>
                      <td className="num">{s.toolCalls}{s.toolErrors > 0 && <span className="text-err"> ({s.toolErrors} failed)</span>}</td>
                      <td className="num text-fg-dim">{Math.round(s.dataQuality)}</td>
                      <td className="num text-fg-dim whitespace-nowrap">{fmtRel(s.lastEventAt, data.generatedAtMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.sessions.length < data.totalParsedSessions && (
            <div className="flex items-center justify-between gap-2 border-t border-bd-subtle px-3 py-2">
              <span className="text-[11px] text-fg-dim tabular-nums">{loadedLabel}</span>
              {moreAvailable ? (
                <button
                  onClick={loadMore}
                  disabled={loadingMore || loading}
                  className="flex min-h-10 items-center gap-1.5 rounded-md border border-bd px-2.5 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {loadingMore
                    ? <RefreshCw className="size-3.5 animate-spin" />
                    : <ChevronDown className="size-3.5" />}
                  {loadingMore
                    ? "Loading…"
                    : `Load ${fmtNumFull(Math.min(LOAD_STEP, data.totalParsedSessions - data.sessions.length))} more`}
                </button>
              ) : (
                <span className="text-[11px] text-fg-dim">
                  older sessions aren&apos;t listable — the scanner keeps only the newest sessions per harness
                </span>
              )}
            </div>
          )}
        </div>
      </section>}

      {data.anyEstimatedCost && (
        <p className="text-[11px] text-fg-dim mt-3 max-w-[90ch]">
          ~ Dollar values are <span className="text-fg-muted">API-equivalent list estimates</span>, not provider spend. They use token evidence and {data.pricingSource} rates checked {data.pricingListDate} (live catalog when newer); family and fallback mappings remain labeled. Long-context surcharges may be missing when transcripts lack threshold evidence.
        </p>
      )}
        </main>
      </div>
    </div>
  );
}
