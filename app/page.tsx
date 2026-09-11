import { DashboardUsagePeriods } from "@/components/DashboardUsagePeriods";
import fs from "node:fs";
import Link from "next/link";
import clsx from "clsx";
import { countRuns, listRuns } from "@/lib/db";
import { formatCaseLoadErrors, loadCasesWithErrors } from "@/lib/cases";
import { CASES_DIR } from "@/lib/config";
import { auditCases } from "@/lib/accuracy";
import { loadDashboardObservationSnapshot } from "@/lib/dashboard-observation";
import HarnessBadge from "@/components/HarnessBadge";
import RecentSessions from "@/components/RecentSessions";
import FirstRunGuide from "@/components/FirstRunGuide";
import { KIND_ICON } from "@/components/markerKinds";
import { Sparkline } from "@/components/Sparkline";
import { fmtNum, fmtNumFull, fmtUsd, fmtUsdFull, fmtDuration, fmtSigned, fmtPct, fmtDateTime } from "@/lib/format";
import { presentSummaryCost } from "@/lib/cost-display";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Boxes, Brain, CircleHelp, Clock3, Cpu, DollarSign, FileText, Gavel, LayoutDashboard, Palette, Radio, RefreshCw, Search, Timer, TrendingDown, TrendingUp, Wrench, Zap,
} from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { EvidenceComposition } from "@/components/evidence/EvidenceComposition";
import { ActivityDayStrip } from "@/components/live/ActivityDayStrip";
import { displayModelId } from "@/lib/pricing";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import type { TimelineReport } from "@/lib/insights/collect";
import DashboardTrends from "@/components/DashboardTrends";

export const dynamic = "force-dynamic";

const CAT_COLORS: Record<string, string> = {
  "agentic-swe": "bg-accent",
  "single-tool": "bg-accent-soft",
  "reasoning": "bg-purple-400",
  "visual-code": "bg-cyan-400",
};

const CAT_ICONS: Record<string, typeof Wrench> = {
  "agentic-swe": Wrench,
  "single-tool": Zap,
  "reasoning": Brain,
  "visual-code": Palette,
};


export default async function Page() {
  const runs = listRuns(5);
  const totalRuns = countRuns();
  const loadedCases = await loadCasesWithErrors();
  const cases = loadedCases.cases;
  const accuracy = auditCases(cases, {
    casesDir: CASES_DIR,
    fileExists: (candidate) => fs.existsSync(candidate),
    corpusErrors: formatCaseLoadErrors(loadedCases.errors),
  });
  const lastRun = runs[0];
  const summary = lastRun?.summary;
  const lastRunCost = summary
    ? presentSummaryCost(summary, summary.totalCostUsd < 1 ? 4 : 2)
    : null;

  // The dashboard unifies both halves of the product: eval runs (Evaluate) and
  // real-session analytics (Observe). Either half failing must not blank the
  // page — but it must remain visibly unavailable rather than looking empty.
  const { collection, timeline, collectionError, timelineError } = await loadDashboardObservationSnapshot();

  const byCat = cases.reduce<Record<string, number>>((a, c) => { a[c.category] = (a[c.category] || 0) + 1; return a; }, {});
  const recentSessions = collection?.sessions.slice(0, 6) ?? [];
  // True first run: no eval runs recorded AND the collection scan measurably
  // found zero session files — totalFiles counts detect-only (parseable:false)
  // sources too, so an operator with e.g. only Cursor history is not dropped
  // into the intro guide. A failed scan (null) is "unknown", not "empty": the
  // guide requires a successful scan that found nothing.
  const firstRun = totalRuns === 0 && collection !== null && collection.totalFiles === 0;
  const trend = timeline?.overall.trend ?? 0;
  const TrendIcon = trend >= 0 ? TrendingUp : TrendingDown;
  const topImpacts = (timeline?.impacts ?? []).filter((im) => !im.lowConfidence).slice(0, 3);
  const trendAvailable = Boolean(timeline && timeline.signalSessions >= 2 && timeline.overall.comparable !== false);
  const recentFailedRuns = runs.filter((run) => run.status === "failed").length;
  const inferredCostSessions = collection?.totalInferredCostSessions ?? (collection?.anyEstimatedCost ? 1 : 0);
  const missingCostSessions = collection
    ? Math.max(0, collection.totalParsedSessions - collection.totalMeasuredCostSessions - inferredCostSessions)
    : 0;
  const attention = buildDashboardAttention({
    collection,
    timeline,
    collectionError,
    timelineError,
    accuracyUnknownCases: accuracy.unknownCases,
    accuracyUnknownSurfaces: Object.values(accuracy.surfaces).filter((surface) => surface.status === "unknown").length,
    failedRuns: recentFailedRuns,
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <header className="mb-6 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-6 md:px-8 py-6 border-b border-bd-subtle bg-gradient-to-b from-bg-subtle/50 to-transparent">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent-soft">
              <LayoutDashboard className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-balance">Dashboard</h1>
              <p className="mt-1 max-w-[64ch] text-sm leading-5 text-fg-muted">
              Benchmark agent CLIs — and learn from every real session they&apos;ve ever run on this machine.
              {collection && collection.presentSources > 0 && (
                <span className="text-fg-dim"> Currently observing {collection.presentSources} source{collection.presentSources === 1 ? "" : "s"} · {fmtNum(collection.totalParsedSessions)} sessions.</span>
              )}
            </p>
            </div>
          </div>
          <form action="/collection" method="get" className="dashboard-search flex min-h-11 w-full items-center gap-2 rounded-xl border border-bd bg-bg-subtle px-3 py-2 sm:w-auto sm:min-w-[320px]">
            <Search className="size-4 text-fg-dim shrink-0" />
            <input
              name="q"
              placeholder="Search every session, every harness…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
              aria-label="Search sessions"
            />
            <kbd className="hidden sm:block text-[10px] text-fg-dim border border-bd rounded px-1.5 py-0.5 mono">⏎</kbd>
          </form>
        </div>
      </header>

      {(collectionError && timelineError) && (
        <section
          className="mb-6 rounded-lg border border-warn/35 bg-warn/10 p-4"
          role="alert"
          aria-labelledby="dashboard-observation-warning"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <h2 id="dashboard-observation-warning" className="text-sm font-medium text-warn">
                Session evidence is temporarily unavailable
              </h2>
              <p className="mt-1 text-xs leading-5 text-fg-muted">
                Evaluation runs are still available. Metrics marked unavailable below are not zeroes and are not evidence that no history exists.
              </p>
              <div className="mt-2 space-y-1 text-[11px] text-fg-dim">
                {collectionError && <div><span className="text-warn">Collection scan:</span> {collectionError}</div>}
                {timelineError && <div><span className="text-warn">Timeline analysis:</span> {timelineError}</div>}
              </div>
              <Link href="/" className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent-soft hover:underline">
                <RefreshCw className="size-3" /> Retry dashboard evidence
              </Link>
            </div>
          </div>
        </section>
      )}

      {attention.length > 0 && !timeline && <AttentionPanel items={attention} />}

      {firstRun ? (
        <FirstRunGuide />
      ) : (
      <>

      {/* Verdict-first hero: the one number that matters, with its baseline, plus the
          actionable count inline. Everything below is evidence for this sentence. */}
      {timeline && (
        <section className="card mb-4 overflow-hidden" aria-label="Outcome verdict">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={clsx(
                    "text-4xl font-semibold tracking-tight mono tabular-nums",
                    !trendAvailable ? "text-fg-dim" : trend > 0 ? "text-ok" : trend < 0 ? "text-err" : "text-fg",
                  )}
                >
                  {trendAvailable ? (Math.abs(trend) > 0 && Math.abs(trend) < 0.005 ? (trend < 0 ? "−<0.01" : "+<0.01") : fmtSigned(trend)) : "—"}
                </span>
                <span className="text-sm text-fg-muted">outcome movement, first half → second half</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-dim">
                <span>
                  {timeline && trendAvailable
                    ? `${timeline.overall.firstHalfOutcome.toFixed(2)} → ${timeline.overall.secondHalfOutcome.toFixed(2)} across ${timeline.overall.firstHalfN ?? 0}/${timeline.overall.secondHalfN ?? 0} signal sessions (before/after)`
                    : timelineError ? "analysis unavailable — not evidence that no history exists" : "no comparable outcome evidence yet"}
                </span>
                {summary && summary.total > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-bd bg-bg-elev px-2 py-0.5">
                    <span className="mono tabular-nums font-medium text-fg">{(summary.passRate * 100).toFixed(0)}%</span>
                    <span>last-run pass rate · {summary.passed}/{summary.total} cases</span>
                  </span>
                )}
              </div>
            </div>
            <div className="min-w-0 md:w-[280px] shrink-0">
              {timeline && timeline.outcomeSeries.length > 1 && (
                <>
                  <Sparkline data={timeline.outcomeSeries.map((p) => p.value)} width={280} height={44} responsive drawIn color={trend >= 0 ? "var(--color-ok)" : "var(--color-err)"} />
                  <div className="text-[10px] text-fg-dim mt-1">trailing median per session · full history on <Link href="/collection/timeline" className="text-accent-soft hover:underline">Timeline</Link></div>
                </>
              )}
            </div>
            {attention.length > 0 && (
              <div className="flex flex-wrap gap-2 md:flex-col md:items-end md:justify-center">
                {attention.slice(0, 3).map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    title={item.detail}
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      item.tone === "err"
                        ? "border-err/40 bg-err/10 text-err hover:bg-err/15"
                        : item.tone === "warn"
                          ? "border-warn/40 bg-warn/10 text-warn hover:bg-warn/15"
                          : "border-bd bg-bg-elev text-fg-muted hover:bg-bg-subtle",
                    )}
                  >
                    {item.tone === "err" ? <AlertTriangle className="size-3" /> : <CircleHelp className="size-3" />}
                    {item.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="stagger-grid grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          icon={Boxes}
          label="Sessions collected"
          hint="Parsed agent sessions across every harness this machine has run. Partial scans still count what was read."
          value={collection ? fmtNum(collection.totalParsedSessions) : "—"}
          sub={collection
            ? [
              collection.partial || collection.inventoryPartial ? "coverage partial" : null,
              collection.totalArchivedSessions > 0 ? `incl. ${fmtNum(collection.totalArchivedSessions)} archived` : `${collection.presentSources} sources`,
            ].filter(Boolean).join(" · ")
            : collectionError ? "scan unavailable" : "not scanned"}
          href="/collection"
        />
        <Stat
          icon={DollarSign}
          label="API equivalent (all time)"
          hint="What these sessions would have cost at published API list rates. Estimated from token counts — not actual provider billing."
          value={collection ? (collection.anyEstimatedCost ? "~" : "") + fmtUsd(collection.totalCostUsd) : "—"}
          title={collection ? `${fmtUsdFull(collection.totalCostUsd)} at API list rates; not actual subscription or provider spend. ${fmtNum(inferredCostSessions)} session costs are inferred and ${fmtNum(missingCostSessions)} are unavailable.` : undefined}
          sub={collection ? [
            `${fmtNum(collection.totalInputTokens + collection.totalOutputTokens)} processed I/O tokens`,
            inferredCostSessions > 0 ? `${fmtNum(inferredCostSessions)} estimated` : null,
            missingCostSessions > 0 ? `${fmtNum(missingCostSessions)} unavailable` : null,
          ].filter(Boolean).join(" · ") : undefined}
          href="/collection"
        />
        <Stat
          icon={trend >= 0 ? TrendingUp : TrendingDown}
          label="Outcome trend"
          value={trendAvailable ? (Math.abs(trend) > 0 && Math.abs(trend) < 0.005 ? (trend < 0 ? "−<0.01" : "+<0.01") : fmtSigned(trend)) : "—"}
          tone={trendAvailable ? (trend > 0 ? "ok" : trend < 0 ? "err" : undefined) : undefined}
          sub={timeline && trendAvailable
            ? `${timeline.overall.firstHalfOutcome.toFixed(2)} → ${timeline.overall.secondHalfOutcome.toFixed(2)}`
            : timelineError ? "analysis unavailable" : "no comparable outcome evidence"}
          href="/collection/timeline"
        />
        <Stat
          icon={Gavel}
          label="LLM-judged"
          hint="Share of sessions whose outcome was graded by a model judge rather than heuristics from the transcript text."
          value={timeline && timeline.totalSessions > 0 ? fmtPct(timeline.judgedCoverage) : "—"}
          sub={timeline && timeline.totalSessions > 0 ? `signal ${fmtPct(timeline.signalCoverage)}` : timelineError ? "coverage unavailable" : "no session evidence"}
          href="/collection/timeline"
        />
        <Stat icon={Activity} label="Eval runs" value={String(totalRuns)} sub={recentFailedRuns > 0 ? `${recentFailedRuns} recent failed` : summary ? `last: ${(summary.passRate * 100).toFixed(0)}% pass` : "none yet"} href="/runs" />
      </section>
      {/* Inventory context (cases/harnesses) lives on its destination pages; the KPI row
          carries only performance measures. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-dim">
        <Link href="/cases" className="inline-flex items-center gap-1 hover:text-fg-muted transition-colors"><FileText className="size-3" /> {cases.length} test cases across {Object.keys(byCat).length} categories</Link>
      </div>

      <DashboardUsagePeriods />
      <DashboardTrends timeline={timeline} error={timelineError} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium flex items-center gap-1.5"><Radio className="size-3.5 text-accent-soft" /> Recent sessions — all harnesses</h2>
            <Link href="/collection" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              Collection <ArrowRight className="size-3" />
            </Link>
          </div>
          {collectionError ? (
            <DashboardUnavailable
              title="Recent sessions unavailable"
              detail="The collection scan failed, so this slice is unread — not empty. Evaluation runs below are unaffected."
              action="Collection diagnostics"
              href="/collection"
            />
          ) : (
            <RecentSessions sessions={recentSessions} />
          )}
        </section>

        <section className="card flex flex-col p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium flex items-center gap-1.5"><TrendIcon className={clsx("size-3.5", trend >= 0 ? "text-ok" : "text-err")} /> Adoption effects</h2>
            <Link href="/collection/timeline" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              Timeline <ArrowRight className="size-3" />
            </Link>
          </div>
          {timelineError ? (
            <div className="rounded-md border border-warn/25 bg-warn/5 p-4 text-sm">
              <div className="font-medium text-warn">Adoption effects unavailable</div>
              <div className="mt-1 text-xs leading-5 text-fg-muted">
                The trend verdict above stands on its own; per-adoption effects need the Timeline analysis cache.
              </div>
              <Link href="/collection/timeline" className="mt-3 inline-flex items-center gap-1 text-xs text-accent-soft hover:underline">
                Open Timeline <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : topImpacts.length > 0 ? (
            <div className="flex-1 space-y-2">
              {topImpacts.map((im) => {
                const Icon = KIND_ICON[im.marker.kind];
                return (
                  <div key={`${im.marker.kind}-${im.marker.name}`} className="flex items-center gap-2 text-sm min-w-0">
                    <Icon className="size-3.5 text-fg-dim shrink-0" />
                    <span className="min-w-0 flex-1 break-all line-clamp-1" title={im.marker.name}>{im.marker.name}</span>
                    <span className={clsx("mono tabular-nums text-xs shrink-0", im.deltas.outcome > 0 ? "text-ok" : im.deltas.outcome < 0 ? "text-err" : "text-fg-dim")}>
                      {fmtSigned(im.deltas.outcome)}
                    </span>
                  </div>
                );
              })}
              <div className="pt-2 text-[10px] text-fg-dim">
                Outcome delta when each marker was adopted · correlation only, caveats on <Link href="/collection/timeline" className="text-accent-soft hover:underline">Timeline</Link>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-sm text-fg-dim">Not enough verified session history for adoption effects yet.</div>
          )}
        </section>
      </div>
      </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium flex items-center gap-1.5"><Activity className="size-3.5 text-accent-soft" /> Recent runs</h2>
            <Link href="/runs" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {runs.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="size-8 text-fg-dim mx-auto mb-3 opacity-50" />
              <div className="text-sm text-fg-muted mb-1">No runs yet</div>
              <Link href="/runs/new" className="text-sm text-accent-soft hover:underline">Start your first evaluation →</Link>
            </div>
          ) : (
            <div className="space-y-1.5">
              {runs.map((r) => (
                <div key={r.id} className="px-3 py-2.5 rounded-md border border-transparent transition-[background-color,border-color] duration-150 hover:border-bd-subtle hover:bg-bg-elev/60">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                    <div className="min-w-0">
                      <Link href={`/runs/${r.id}`} className="font-medium text-sm truncate block hover:text-accent-soft">{r.name}</Link>
                      <div className="text-[11px] text-fg-dim mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {fmtDateTime(Number(r.created_at))} · {r.params.runner}
                        {r.params.harness && <HarnessBadge harness={r.params.harness} />}
                        <span>· {r.params.parallel}×</span>
                        {r.params.samples && r.params.samples > 1 ? <span>· {r.params.samples} samples</span> : null}
                      </div>
                    </div>
                    <Link href={`/runs/${r.id}`} className="flex items-center gap-3 shrink-0 hover:text-accent-soft transition-colors" aria-label={`Open ${r.name}`}>
                      {r.summary && (
                        <div className="text-right">
                          <div className="text-sm font-semibold mono tabular-nums">
                            {r.summary.passed}/{r.summary.total}
                          </div>
                          <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-bg-elev">
                            {r.summary.total > 0 && (
                              <div className="h-full flex">
                                <div className="rounded-l-full bg-ok" style={{ width: `${(r.summary.passed / r.summary.total) * 100}%` }} />
                                {(r.summary.failed > 0 || r.summary.errored > 0) && (
                                  <div className="bg-err" style={{ width: `${(r.summary.failed / r.summary.total) * 100}%` }} />
                                )}
                                {r.summary.errored > 0 && (
                                  <div className="bg-warn" style={{ width: `${(r.summary.errored / r.summary.total) * 100}%` }} />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Lifecycle is context, not verdict — demoted to a glyph so the
                          pass fraction reads as the single authoritative outcome. */}
                      <span
                        className="text-fg-dim"
                        title={`Run ${r.status}`}
                        aria-label={`Run ${r.status}`}
                      >
                        {r.status === "failed" ? <AlertTriangle className="size-3.5 text-err" /> : <CircleHelp className="size-3.5" />}
                      </span>
                    </Link>
                    <Link href={`/runs/${r.id}/bench`} className="min-h-8 min-w-8 flex items-center justify-center text-fg-dim hover:text-accent-soft transition-colors" aria-label={`Open bench for ${r.name}`}>
                      <BarChart3 className="size-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
                    {summary && runs.length > 0 && (
              <div className="mt-3 border-t border-bd/50 pt-3">
                <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-fg-muted">Last run — {runs[0]?.name}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Mini label="Total duration" value={fmtDuration(summary.totalDurationMs)} icon={Timer} />
                  <Mini label={lastRunCost?.label ?? "Total cost"} value={lastRunCost?.value ?? "missing"} icon={DollarSign} />
                  <Mini label="Tokens in" value={fmtNumFull(summary.totalTokensIn)} icon={Cpu} />
                  <Mini label="Tokens out" value={fmtNumFull(summary.totalTokensOut)} icon={Cpu} />
                </div>
              </div>
            )}
</section>

        <section className="card p-5">
          <h2 className="text-sm font-medium mb-4 flex items-center gap-1.5"><FileText className="size-3.5 text-accent-soft" /> Case library</h2>
          <div className="space-y-3">
            {Object.entries(byCat).map(([cat, count]) => (
              <Link key={cat} href={`/cases?category=${cat}`} className="group block rounded-md px-2 py-1.5 transition-colors hover:bg-bg-elev">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const CatIcon = CAT_ICONS[cat];
                      return CatIcon ? <CatIcon aria-hidden="true" className="size-3.5 text-fg-dim shrink-0" /> : null;
                    })()}
                    <span className={clsx("size-2 rounded-full", CAT_COLORS[cat] ?? "bg-accent")} />
                    <span className="text-sm group-hover:text-accent-soft transition-colors">{cat}</span>
                  </div>
                  <span className="text-xs text-fg-muted mono tabular-nums">{count}</span>
                </div>
                <div className="mt-1.5 h-1 bg-bg-elev rounded-full overflow-hidden">
                  <div className={clsx("h-full transition-[width] duration-300", CAT_COLORS[cat] ?? "bg-accent")} style={{ width: `${cases.length > 0 ? (count / cases.length) * 100 : 0}%` }} />
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-bd">
            <Link href="/cases" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              Browse all cases <ArrowRight className="size-3" />
            </Link>
          </div>
        </section>
      </div>

      {/* Source inventory + tooling health: the pipeline view the KPI row abstracts away.
          A failed scan is unavailable, not empty — the panel vanishing would read as zero. */}
      {collection ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="card cv-auto p-5 lg:col-span-2" aria-labelledby="dash-sources-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="dash-sources-title" className="text-sm font-medium flex items-center gap-1.5"><Boxes className="size-3.5 text-accent-soft" /> Sources</h2>
              <Link href="/collection" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">Collection <ArrowRight className="size-3" /></Link>
            </div>
            <div className="space-y-3">
              {collection.sources.map((s) => {
                const sessions = s.parsedSessions;
                const maxSessions = Math.max(1, ...collection.sources.map((x) => x.parsedSessions));
                return (
                  <div key={s.id} className="min-w-0">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={clsx("size-1.5 rounded-full shrink-0", s.status === "present" ? "bg-ok" : s.status === "empty" ? "bg-fg-dim" : "bg-bd")} aria-hidden="true" />
                        <span className="truncate text-fg" title={`${s.label} · ${s.format}`}>{s.label}</span>
                        {!s.parseable && <span className="shrink-0 rounded border border-warn/40 px-1 text-[9px] uppercase tracking-wide text-warn">detect-only</span>}
                        {s.archivedSessions > 0 && <span className="shrink-0 text-fg-dim">+{fmtNum(s.archivedSessions)} archived</span>}
                      </span>
                      <span className="mono shrink-0 tabular-nums text-fg-dim">{fmtNum(sessions)} sessions · {fmtNum(s.filesFound)} files</span>
                    </div>
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`${s.label}: ${sessions} sessions of ${maxSessions} max`} title={`${sessions} sessions parsed from ${s.filesFound} files`}>
                      <div className={clsx("h-full rounded-full transition-[width] duration-500", sessions > 0 ? "bg-accent/50" : "bg-bg-elev")} style={{ width: `${Math.max(sessions > 0 ? 2 : 0, (sessions / maxSessions) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Time dimension for the source inventory: the KPI row says how much, this
                says when. Reuses the Live activity strip (keyboard-focusable columns,
                aria-live day chip) fed from the already-parsed session list — no fetch. */}
            {collection.totalParsedSessions > 0 && (
              <div className="mt-4 border-t border-bd pt-4">
                <ActivityDayStrip startedAts={collection.sessions.map((s) => s.lastEventAt)} />
              </div>
            )}
          </section>

          {/* Token economy: cache vs. fresh-token composition, hit rate, and spend efficiency —
              the panel for anyone watching context bills. All server-computed from the scan. */}
          {collection && collection.totalInputTokens + collection.totalOutputTokens + collection.totalCacheReadTokens > 0 && (() => {
            const cacheRead = collection.totalCacheReadTokens;
            const input = collection.totalInputTokens;
            const output = collection.totalOutputTokens;
            const fresh = input + output;
            const total = cacheRead + fresh;
            const hitRate = total > 0 ? cacheRead / total : 0;
            // Efficiency: API-equivalent dollars per 1M fresh units (cache reads are ~10x
            // cheaper on list rates, so fresh units are the spend driver).
            const per1M = fresh > 0 ? (collection.totalCostUsd / (fresh / 1_000_000)) : 0;
            const seg = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`;
            return (
              <section className="card p-5" aria-labelledby="dash-token-economy-title">
                <div className="flex items-center justify-between mb-4">
                  <h2 id="dash-token-economy-title" className="text-sm font-medium flex items-center gap-1.5"><Cpu className="size-3.5 text-accent-soft" /> Token economy</h2>
                  <Link href="/collection" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">Collection <ArrowRight className="size-3" /></Link>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <div className="rounded-md border border-bd-subtle bg-bg-subtle/40 p-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Cache hit rate</div>
                    <div className="text-2xl font-semibold mono tabular-nums text-ok mt-1">{(hitRate * 100).toFixed(1)}%</div>
                    <div className="text-[10px] text-fg-dim mt-0.5">of all units processed were served from prompt cache</div>
                  </div>
                  <div className="rounded-md border border-bd-subtle bg-bg-subtle/40 p-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Fresh units</div>
                    <div className="text-2xl font-semibold mono tabular-nums text-fg mt-1">{fmtNum(fresh)}</div>
                    <div className="text-[10px] text-fg-dim mt-0.5">input + output — the units that drive spend</div>
                  </div>
                  <div className="rounded-md border border-bd-subtle bg-bg-subtle/40 p-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Spend efficiency</div>
                    <div className="text-2xl font-semibold mono tabular-nums text-fg mt-1">{per1M > 0 ? fmtUsd(per1M) : "—"}</div>
                    <div className="text-[10px] text-fg-dim mt-0.5">API-equivalent per 1M fresh units · lower is better</div>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] text-fg-dim">
                    <span>Composition of {fmtNum(total)} processed units</span>
                    <span className="mono tabular-nums">{(hitRate * 100).toFixed(0)}% cached</span>
                  </div>
                  <div className="flex h-4 overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`Unit composition: cache reads ${fmtNum(cacheRead)}, input ${fmtNum(input)}, output ${fmtNum(output)}`}>
                    <div className="h-full" style={{ width: seg(cacheRead), background: "color-mix(in srgb, var(--color-accent) 30%, transparent)" }} title={`Cache reads: ${fmtNumFull(cacheRead)}`} />
                    <div className="h-full" style={{ width: seg(input), background: "var(--color-accent)" }} title={`Input: ${fmtNumFull(input)}`} />
                    <div className="h-full" style={{ width: seg(output), background: "var(--color-ok)" }} title={`Output: ${fmtNumFull(output)}`} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-fg-dim">
                    <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px]" style={{ background: "color-mix(in srgb, var(--color-accent) 30%, transparent)" }} /> cache reads {fmtNum(cacheRead)}</span>
                    <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px]" style={{ background: "var(--color-accent)" }} /> input {fmtNum(input)}</span>
                    <span className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px]" style={{ background: "var(--color-ok)" }} /> output {fmtNum(output)}</span>
                  </div>
                </div>
              </section>
            );
          })()}

          <div className="flex flex-col gap-4">
            <section className="card p-5" aria-labelledby="dash-tooling-title">
              <h2 id="dash-tooling-title" className="text-sm font-medium mb-4 flex items-center gap-1.5"><Wrench className="size-3.5 text-accent-soft" /> Tooling</h2>
              <div className="space-y-3">
                <Mini label="Tool calls (all sessions)" value={fmtNum(collection.totalToolCalls)} icon={Wrench} />
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-fg-muted">Evidence provenance</span>
                    <Link href="/collection" className="text-[10px] text-accent-soft hover:underline">details</Link>
                  </div>
                  <EvidenceComposition
                    label="Cost evidence"
                    total={collection.totalParsedSessions}
                    segments={[
                      { label: "measured", value: collection.totalMeasuredCostSessions ?? 0, tone: "measured" },
                      { label: "inferred", value: collection.totalInferredCostSessions ?? 0, tone: "inferred" },
                      { label: "unavailable", value: Math.max(0, collection.totalParsedSessions - (collection.totalMeasuredCostSessions ?? 0) - (collection.totalInferredCostSessions ?? 0)), tone: "missing" },
                    ]}
                    className="text-xs"
                  />
                </div>
              </div>
            </section>

            <section className="card p-5" aria-labelledby="dash-models-title">
              <h2 id="dash-models-title" className="text-sm font-medium mb-4 flex items-center gap-1.5"><Cpu className="size-3.5 text-accent-soft" /> Models</h2>
              {(() => {
                const models = [...(collection.byModel ?? [])].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)).slice(0, 5);
                const maxTok = Math.max(1, ...models.map((m) => m.inputTokens + m.outputTokens));
                if (models.length === 0) return <div className="text-sm text-fg-dim">No model metadata in the parsed slice.</div>;
                return (
                  <div className="space-y-2.5">
                    {models.map((m) => {
                      const toks = m.inputTokens + m.outputTokens;
                      const label = displayModelId(m.model) ?? "unknown";
                      return (
                        <div key={m.model} className="min-w-0">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="mono truncate text-fg" title={m.model}>{label}</span>
                            <span className="mono shrink-0 tabular-nums text-fg-dim">{fmtNum(toks)} tok · {fmtNum(m.sessions)} sessions</span>
                          </div>
                          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`${label}: ${fmtNum(toks)} tokens`} title={`${fmtNumFull(toks)} tokens · ${fmtNum(m.toolCalls)} tool calls`}>
                            <div className="h-full rounded-full bg-accent/50 transition-[width] duration-500" style={{ width: `${Math.max(2, (toks / maxTok) * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>
          </div>
        </div>
      ) : collectionError ? (
        <DashboardUnavailable
          title="Source inventory unavailable"
          detail="The collection scan failed, so sources, tooling, and model panels are unread — not absent because nothing exists. The KPI row's unavailable markers are the same failure."
          action="Collection diagnostics"
          href="/collection"
        />
      ) : null}

    </div>
  );
}

/** Per-section unavailable state: names the unread surface, insists it is not empty,
 *  and routes to diagnostics — the dashboard's unavailable≠empty contract, localized. */
function DashboardUnavailable({ title, detail, action, href }: { title: string; detail: string; action: string; href: string }) {
  return (
    <div className="rounded-md border border-warn/25 bg-warn/5 p-4 text-sm">
      <div className="font-medium text-warn">{title}</div>
      <div className="mt-1 text-xs leading-5 text-fg-muted">{detail}</div>
      <Link href={href} className="mt-3 inline-flex items-center gap-1 text-xs text-accent-soft hover:underline">
        {action} <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}

type AttentionTone = "warn" | "err" | "info";

interface DashboardAttention {
  id: string;
  title: string;
  detail: string;
  action: string;
  href: string;
  tone: AttentionTone;
}

function buildDashboardAttention({
  collection,
  timeline: _timeline,
  collectionError,
  timelineError,
  accuracyUnknownCases,
  accuracyUnknownSurfaces,
  failedRuns,
}: {
  collection: AllSourcesResult | null;
  timeline: TimelineReport | null;
  collectionError: string | null;
  timelineError: string | null;
  accuracyUnknownCases: number;
  accuracyUnknownSurfaces: number;
  failedRuns: number;
}): DashboardAttention[] {
  const items: DashboardAttention[] = [];
  const add = (item: DashboardAttention) => items.push(item);

  if (collectionError) {
    add({
      id: "collection-error",
      title: "Collection scan failed",
      detail: "Session metrics are unavailable; the dashboard is not treating the failure as an empty history.",
      action: "Open Collection diagnostics",
      href: "/collection",
      tone: "err",
    });
  } else if (collection && (collection.partial || collection.inventoryPartial)) {
    add({
      id: "partial-scan",
      title: "Collection coverage is partial",
      detail: "The displayed totals are a lower bound because discovery or parsing stopped before the corpus was proven complete.",
      action: "Review scan coverage",
      href: "/collection",
      tone: "warn",
    });
  }

  if (timelineError) {
    add({
      id: "timeline-error",
      title: "Timeline analysis failed",
      detail: "Outcome and impact metrics are unavailable until the analysis cache is readable again.",
      action: "Open Timeline diagnostics",
      href: "/collection/timeline",
      tone: "err",
    });
  }

  if (collection && collection.totalParsedSessions > 0) {
    const inferred = collection.totalInferredCostSessions ?? (collection.anyEstimatedCost ? 1 : 0);
    const missing = Math.max(0, collection.totalParsedSessions - collection.totalMeasuredCostSessions - inferred);
    if (inferred > 0 || missing > 0) {
      add({
        id: "cost-evidence",
        title: "Cost evidence needs review",
        detail: `${inferred} session cost${inferred === 1 ? " is" : "s are"} estimated and ${missing} ${missing === 1 ? "is" : "are"} unavailable; the API-equivalent total is not provider spend.`,
        action: "Review cost provenance",
        href: "/collection",
        tone: "warn",
      });
    }
  }

  if (accuracyUnknownCases > 0 || accuracyUnknownSurfaces > 0) {
    add({
      id: "accuracy-unknown",
      title: "Accuracy evidence is incomplete",
      detail: `${accuracyUnknownCases} case${accuracyUnknownCases === 1 ? "" : "s"} and ${accuracyUnknownSurfaces} evidence surface${accuracyUnknownSurfaces === 1 ? "" : "s"} remain unknown because runtime or human proof is not attached.`,
      action: "Review Accuracy evidence",
      href: "/accuracy",
      tone: "warn",
    });
  }

  if (collection && (collection.stale === true || collection.refreshing === true || (collection.totalStaleSessions ?? 0) > 0)) {
    const aged = collection.totalStaleSessions ?? 0;
    add({
      id: "stale-evidence",
      title: collection.refreshing ? "Collection refresh is in progress" : "Evidence freshness needs review",
      detail: collection.stale
        ? "Collection is serving a last-known snapshot while a refresh completes."
        : aged > 0
          ? `${aged} session summaries have aged beyond the freshness window; inspect their source and timestamp.`
          : "The current Collection snapshot is marked stale.",
      action: "Check Collection freshness",
      href: "/collection",
      tone: "info",
    });
  } else if (collection && (collection.totalFiles > 0 || collection.totalParsedSessions > 0) && collection.stale === undefined) {
    add({
      id: "freshness-unavailable",
      title: "Freshness status is unavailable here",
      detail: "The Dashboard loader does not expose snapshot freshness. Collection has the authoritative scan timestamp and refresh state.",
      action: "Check Collection timestamp",
      href: "/collection",
      tone: "info",
    });
  }

  if (failedRuns > 0) {
    add({
      id: "failed-runs",
      title: `${failedRuns} recent evaluation${failedRuns === 1 ? "" : "s"} failed`,
      detail: "Open the run history to inspect the failing cases and their retained error details.",
      action: "Inspect failed runs",
      href: "/runs",
      tone: "err",
    });
  }

  // Keep the dashboard scan concise; the destination pages retain the full
  // source-level evidence and diagnostics.
  return items.slice(0, 6);
}

function AttentionPanel({ items }: { items: DashboardAttention[] }) {
  return (
    <section className="mb-6 rounded-lg border border-bd bg-bg-subtle/60 p-4" aria-labelledby="dashboard-attention-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="dashboard-attention-title" className="flex items-center gap-2 text-sm font-semibold">
            <CircleHelp className="size-4 text-warn" aria-hidden="true" />
            Attention
          </h2>
          <p className="mt-1 text-xs text-fg-muted">Signals with a next action. A warning here is not a zero.</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            {items.filter((it) => it.tone === "err").length > 0 && <>{items.filter((it) => it.tone === "err").length} error{items.filter((it) => it.tone === "err").length === 1 ? "" : "s"} · </>}
            {items.filter((it) => it.tone === "warn").length} warning{items.filter((it) => it.tone === "warn").length === 1 ? "" : "s"}
            {items.filter((it) => it.tone === "info").length > 0 && <> · {items.filter((it) => it.tone === "info").length} info</>}
          </span>
      </div>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-2">
        {items.map((item) => {
          const Icon = item.tone === "err" ? AlertTriangle : item.tone === "info" ? Clock3 : CircleHelp;
          const tone = item.tone === "err"
            ? "border-bd-subtle bg-err/5 border-l-2 border-l-err/60"
            : item.tone === "info"
              ? "border-bd-subtle bg-accent/5 border-l-2 border-l-accent/60"
              : "border-bd-subtle bg-warn/5 border-l-2 border-l-warn/60";
          const iconTone = item.tone === "err" ? "text-err" : item.tone === "info" ? "text-accent-soft" : "text-warn";
          return (
            <li key={item.id}>
              <Link href={item.href} className={clsx("attention-card group block h-full rounded-lg border p-3", tone)}>
                <div className="flex items-start gap-2.5">
                  <Icon className={clsx("mt-0.5 size-4 shrink-0", iconTone)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-medium">{item.title}</h3>
                    <p className="mt-1 text-[11px] leading-5 text-fg-muted">{item.detail}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-soft">
                      {item.action} <ArrowRight className="size-3" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ icon: Icon, label, value, sub, href, tone, title, hint }: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone?: "ok" | "err";
  title?: string;
  hint?: string;
}) {
  // The whole card is clickable via a stretched link EXCEPT the info hint, which sits
  // above it (z-index + relative) so its tooltip/focus never triggers navigation.
  return (
    <div className="card interactive-card group relative block p-4">
      <Link href={href} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent after:focus-visible:ring-2 after:focus-visible:ring-accent" aria-label={`${label}: ${value}${sub ? ` — ${sub}` : ""}`}>
        <div className="flex items-center justify-between">
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-fg-muted">
            <span className="truncate">{label}</span>
            {/* Visually beside the label; positioned above the stretched link so the
                hint is hoverable/focusable without navigating. */}
            {hint && (
              <span className="relative z-10">
                <InfoHint term={label} explanation={hint} />
              </span>
            )}
          </span>
          <div className="grid place-items-center size-7 rounded-md bg-accent/10 shrink-0">
            <Icon className="size-3.5 text-accent-soft" />
          </div>
        </div>
        <div className={clsx("text-2xl font-semibold mt-2 mono tabular-nums", tone === "ok" && "text-ok", tone === "err" && "text-err")} title={title}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-fg-dim mono mt-0.5 truncate">{sub}</div>}
      </Link>
    </div>
  );
}

function Mini({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Activity; tone?: "warn" }) {
  return (
    <div className="border border-bd rounded-md p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("text-base font-medium mono", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}
