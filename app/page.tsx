import Link from "next/link";
import clsx from "clsx";
import { countRuns, listRuns } from "@/lib/db";
import { loadCases } from "@/lib/cases";
import { collectAllSessions, scanAllSources, type AllSourcesResult } from "@/lib/collection/aggregate";
import { buildTimeline, type TimelineReport } from "@/lib/insights/collect";
import StatusBadge from "@/components/StatusBadge";
import HarnessBadge from "@/components/HarnessBadge";
import RecentSessions from "@/components/RecentSessions";
import { KIND_ICON } from "@/components/markerKinds";
import { Sparkline } from "@/components/Sparkline";
import { fmtNum, fmtNumFull, fmtUsd, fmtUsdFull, fmtDuration, fmtSigned, fmtPct } from "@/lib/format";
import { presentSummaryCost } from "@/lib/cost-display";
import {
  Activity, ArrowRight, BarChart3, Boxes, Cpu, DollarSign, FileText, Gavel, Radio, Search, Timer, TrendingDown, TrendingUp,
} from "lucide-react";

export const dynamic = "force-dynamic";

const CAT_COLORS: Record<string, string> = {
  "agentic-swe": "bg-accent",
  "single-tool": "bg-ok",
  "reasoning": "bg-warn",
  "visual-code": "bg-blue-500",
};


export default async function Page() {
  const runs = listRuns(5);
  const totalRuns = countRuns();
  const cases = await loadCases();
  const lastRun = runs[0];
  const summary = lastRun?.summary;
  const lastRunCost = summary
    ? presentSummaryCost(summary, summary.totalCostUsd < 1 ? 4 : 2)
    : null;

  // The dashboard unifies both halves of the product: eval runs (Evaluate) and
  // real-session analytics (Observe). Either half failing must not blank the page.
  let collection: AllSourcesResult | null = null;
  let timeline: TimelineReport | null = null;
  try { collection = scanAllSources(12); } catch {}
  // Same fingerprint-memoized snapshot as scanAllSources — the timeline no
  // longer re-parses the full history on every dashboard render.
  try { timeline = buildTimeline(collectAllSessions()); } catch {}

  const byCat = cases.reduce<Record<string, number>>((a, c) => { a[c.category] = (a[c.category] || 0) + 1; return a; }, {});
  const recentSessions = collection?.sessions.slice(0, 6) ?? [];
  const trend = timeline?.overall.trend ?? 0;
  const TrendIcon = trend >= 0 ? TrendingUp : TrendingDown;
  const topImpacts = (timeline?.impacts ?? []).filter((im) => !im.lowConfidence).slice(0, 3);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <header className="mb-6 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-6 md:px-8 py-6 border-b border-bd-subtle bg-gradient-to-b from-bg-subtle/50 to-transparent">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-fg-muted mt-1">Benchmark agent CLIs — and learn from every real session they&apos;ve ever run on this machine.</p>
          </div>
          <form action="/collection" method="get" className="flex items-center gap-2 rounded-lg border border-bd bg-bg-subtle px-3 py-2 w-full sm:w-auto sm:min-w-[320px] focus-within:border-accent/60 transition-colors">
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

      <section className="stagger-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <Stat
          icon={Boxes}
          label="Sessions collected"
          value={collection ? fmtNum(collection.totalParsedSessions) : "—"}
          sub={collection && collection.totalArchivedSessions > 0 ? `incl. ${fmtNum(collection.totalArchivedSessions)} archived` : `${collection?.presentSources ?? 0} sources`}
          href="/collection"
        />
        <Stat
          icon={DollarSign}
          label="API equivalent (all time)"
          value={collection ? (collection.anyEstimatedCost ? "~" : "") + fmtUsd(collection.totalCostUsd) : "—"}
          title={collection ? `${fmtUsdFull(collection.totalCostUsd)} at API list rates; not actual subscription or provider spend` : undefined}
          sub={collection ? `${fmtNum(collection.totalInputTokens + collection.totalOutputTokens)} processed I/O tokens` : undefined}
          href="/collection"
        />
        <Stat
          icon={trend >= 0 ? TrendingUp : TrendingDown}
          label="Outcome trend"
          value={timeline ? fmtSigned(trend) : "—"}
          tone={trend > 0 ? "ok" : trend < 0 ? "err" : undefined}
          sub={timeline ? `${timeline.overall.firstHalfOutcome.toFixed(2)} → ${timeline.overall.secondHalfOutcome.toFixed(2)}` : undefined}
          href="/collection/timeline"
        />
        <Stat
          icon={Gavel}
          label="LLM-judged"
          value={timeline ? fmtPct(timeline.judgedCoverage) : "—"}
          sub={timeline ? `signal ${fmtPct(timeline.signalCoverage)}` : undefined}
          href="/collection/timeline"
        />
        <Stat icon={Activity} label="Eval runs" value={String(totalRuns)} sub={summary ? `last: ${(summary.passRate * 100).toFixed(0)}% pass` : "none yet"} href="/runs" />
        <Stat icon={FileText} label="Test cases" value={String(cases.length)} sub={`${Object.keys(byCat).length} categories`} href="/cases" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium flex items-center gap-1.5"><Radio className="size-3.5 text-accent-soft" /> Recent sessions — all harnesses</h2>
            <Link href="/collection" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              Collection <ArrowRight className="size-3" />
            </Link>
          </div>
          <RecentSessions sessions={recentSessions} />
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium flex items-center gap-1.5"><TrendIcon className={clsx("size-3.5", trend >= 0 ? "text-ok" : "text-err")} /> Outcome &amp; impact</h2>
            <Link href="/collection/timeline" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              Timeline <ArrowRight className="size-3" />
            </Link>
          </div>
          {timeline && timeline.outcomeSeries.length > 1 ? (
            <>
              <div className="mb-3">
                <Sparkline data={timeline.outcomeSeries.map((p) => p.value)} width={280} height={44} responsive />
                <div className="text-[10px] text-fg-dim mt-1">Inferred outcome, trailing median · {timeline.totalSessions} sessions</div>
              </div>
              {topImpacts.length > 0 && (
                <div className="space-y-2 border-t border-bd/50 pt-3">
                  <div className="text-[10px] uppercase tracking-wider text-fg-muted">Biggest adoption effects</div>
                  {topImpacts.map((im) => {
                    const Icon = KIND_ICON[im.marker.kind];
                    return (
                      <div key={`${im.marker.kind}-${im.marker.name}`} className="flex items-center gap-2 text-sm min-w-0">
                        <Icon className="size-3.5 text-fg-dim shrink-0" />
                        <span className="truncate flex-1">{im.marker.name}</span>
                        <span className={clsx("mono tabular-nums text-xs shrink-0", im.deltas.outcome > 0 ? "text-ok" : im.deltas.outcome < 0 ? "text-err" : "text-fg-dim")}>
                          {fmtSigned(im.deltas.outcome)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-10 text-sm text-fg-dim">Not enough session history yet.</div>
          )}
        </section>
      </div>

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
                <div key={r.id} className="px-3 py-2.5 rounded-md border border-transparent hover:border-bd-subtle transition-colors">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                    <div className="min-w-0">
                      <Link href={`/runs/${r.id}`} className="font-medium text-sm truncate block hover:text-accent-soft">{r.name}</Link>
                      <div className="text-[11px] text-fg-dim mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {new Date(r.created_at).toLocaleString()} · {r.params.runner}
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
                                <div className="bg-ok" style={{ width: `${(r.summary.passed / r.summary.total) * 100}%` }} />
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
                      <StatusBadge status={r.status} />
                    </Link>
                    <Link href={`/runs/${r.id}/bench`} className="min-h-8 min-w-8 flex items-center justify-center text-fg-dim hover:text-accent-soft transition-colors" aria-label={`Open bench for ${r.name}`}>
                      <BarChart3 className="size-4" />
                    </Link>
                  </div>
                </div>
              ))}
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
                    <span className={clsx("size-2 rounded-full", CAT_COLORS[cat] ?? "bg-accent")} />
                    <span className="text-sm group-hover:text-accent-soft transition-colors">{cat}</span>
                  </div>
                  <span className="text-xs text-fg-muted mono tabular-nums">{count}</span>
                </div>
                <div className="mt-1.5 h-1 bg-bg-elev rounded-full overflow-hidden">
                  <div className={clsx("h-full transition-[width] duration-300", CAT_COLORS[cat] ?? "bg-accent")} style={{ width: `${(count / cases.length) * 100}%` }} />
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

      {summary && (
        <section className="card p-5 mt-4">
          <h2 className="text-sm font-medium mb-4">Last run breakdown</h2>
          <div className="stagger-grid grid grid-cols-2 md:grid-cols-4 gap-3">
            <Mini label="Total duration" value={fmtDuration(summary.totalDurationMs)} icon={Timer} />
            <Mini label={lastRunCost?.label ?? "Total cost"} value={lastRunCost?.value ?? "missing"} icon={DollarSign} />
            <Mini label="Tokens in" value={fmtNumFull(summary.totalTokensIn)} icon={Cpu} />
            <Mini label="Tokens out" value={fmtNumFull(summary.totalTokensOut)} icon={Cpu} />
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, href, tone, title }: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone?: "ok" | "err";
  title?: string;
}) {
  return (
    <Link href={href} className="card p-4 block transition-colors hover:border-accent/40 group">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted truncate">{label}</span>
        <div className="grid place-items-center size-7 rounded-md bg-accent/10 shrink-0">
          <Icon className="size-3.5 text-accent-soft" />
        </div>
      </div>
      <div className={clsx("text-2xl font-semibold mt-2 mono tabular-nums", tone === "ok" && "text-ok", tone === "err" && "text-err")} title={title}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-fg-dim mono mt-0.5 truncate">{sub}</div>}
    </Link>
  );
}

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return (
    <div className="border border-bd rounded-md p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-base font-medium mono">{value}</div>
    </div>
  );
}
