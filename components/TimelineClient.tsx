"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Activity, TrendingUp, TrendingDown, AlertTriangle, ArrowLeft, Puzzle, Plug, Users, Sparkles, Gavel, Scale, LineChart, GitCompareArrows, Zap, CalendarPlus } from "lucide-react";
import PageHeader from "./PageHeader";
import { SectionHeader, SectionNav } from "./Section";
import OutcomeChart from "./OutcomeChart";
import { fmtDate, fmtPct as pct, fmtSigned as signed } from "@/lib/format";
import type { TimelineReport } from "@/lib/insights/collect";
import type { MarkerKind } from "@/lib/insights/timeline";
import type { JudgeJobStatus } from "@/lib/insights/judge";

const KIND_ICON: Record<MarkerKind, typeof Puzzle> = { skill: Sparkles, mcp: Plug, subagent: Users, model: Activity };
const KIND_LABEL: Record<MarkerKind, string> = { skill: "skill", mcp: "plugin", subagent: "subagent", model: "model" };
// Same palette as OutcomeChart's legend, so identity reads consistently across the page.
const KIND_COLOR: Record<MarkerKind, string> = {
  skill: "var(--color-accent-soft)",
  mcp: "var(--color-ok)",
  subagent: "var(--color-warn)",
  model: "var(--color-fg-dim)",
};

/** A colored delta chip. `lowerIsBetter` flips the good/bad coloring. */
function Delta({ value, lowerIsBetter, fmt }: { value: number; lowerIsBetter?: boolean; fmt: (v: number) => string }) {
  const good = lowerIsBetter ? value < 0 : value > 0;
  const bad = lowerIsBetter ? value > 0 : value < 0;
  const tone = Math.abs(value) < 1e-9 ? "text-fg-dim" : good ? "text-ok" : bad ? "text-err" : "text-fg-dim";
  return <span className={clsx("mono tabular-nums", tone)}>{fmt(value)}</span>;
}

/** Diverging mini-bar from a center axis — makes the impact ranking scannable. */
function DeltaBar({ value, max }: { value: number; max: number }) {
  const frac = max > 1e-9 ? Math.min(1, Math.abs(value) / max) : 0;
  const good = value > 1e-9;
  const bad = value < -1e-9;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="relative h-[5px] w-14 rounded-full bg-bg-elev overflow-hidden shrink-0" aria-hidden>
        <div className="absolute inset-y-0 left-1/2 w-px bg-bd" />
        {(good || bad) && (
          <div
            className="absolute inset-y-0 rounded-full"
            style={{
              left: good ? "50%" : `${50 - frac * 50}%`,
              width: `${Math.max(3, frac * 50)}%`,
              background: good ? "var(--color-ok)" : "var(--color-err)",
              opacity: 0.8,
            }}
          />
        )}
      </div>
      <Delta value={value} fmt={(v) => signed(v)} />
    </div>
  );
}

export default function TimelineClient({ data: initialData, error }: { data: TimelineReport; error?: string }) {
  const [data, setData] = useState(initialData);
  const [judging, setJudging] = useState(false);
  const [judgeMsg, setJudgeMsg] = useState<string | null>(null);
  const [err, setErr] = useState(error);
  const [job, setJob] = useState<JudgeJobStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const trend = data.overall.trend;
  const TrendIcon = trend >= 0 ? TrendingUp : TrendingDown;

  const refreshData = useCallback(async () => {
    const fresh = await fetch("/api/collection/timeline");
    if (fresh.ok) setData(await fresh.json());
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/collection/timeline/judge");
        if (!res.ok) return;
        const s: JudgeJobStatus = await res.json();
        setJob(s);
        if (!s.running) {
          stopPolling();
          await refreshData();
        }
      } catch {}
    }, 4000);
  }, [refreshData, stopPolling]);

  // A background job may already be running from an earlier visit — pick it up.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/collection/timeline/judge");
        if (!res.ok) return;
        const s: JudgeJobStatus = await res.json();
        if (s.startedAt) setJob(s);
        if (s.running) startPolling();
      } catch {}
    })();
    return stopPolling;
  }, [startPolling, stopPolling]);

  async function judgeAllWindows() {
    try {
      const res = await fetch("/api/collection/timeline/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      setJob(r.status);
      if (r.started) startPolling();
      else if (!r.status.running) setJudgeMsg("Every marker-window session is already judged.");
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function refineWithJudge() {
    setJudging(true);
    setJudgeMsg(null);
    try {
      const res = await fetch("/api/collection/timeline/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: 10 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      setJudgeMsg(
        r.judged > 0
          ? `Judged ${r.judged}/${r.sampled} sessions via ${r.judge}${r.failed ? ` (${r.failed} failed)` : ""}.`
          : r.sampled === 0
            ? "Every sampled session is already judged."
            : `No verdicts returned (${r.failed} failed via ${r.judge}).${r.lastError ? ` Last error: ${r.lastError}` : ""}`,
      );
      await refreshData();
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setJudging(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/collection" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-2"><ArrowLeft className="size-3.5" /> Collection</Link>
      <PageHeader
        icon={Activity}
        title={<>Timeline &amp; Impact</>}
        subtitle="When skills, plugins, and subagents entered your workflow — and how your inferred outcomes moved around each."
        actions={
          <>
            <button
              onClick={refineWithJudge}
              disabled={judging || !!job?.running}
              title="Re-score a sample of sessions (around each adoption) with an LLM judge. Incremental: verdicts persist, each pass judges up to 10 new sessions."
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
            >
              <Gavel className={clsx("size-3.5", judging && "animate-pulse")} /> {judging ? "Judging…" : "Judge 10"}
            </button>
            <button
              onClick={judgeAllWindows}
              disabled={judging || !!job?.running}
              title="Background job: judge EVERY unjudged session in the impact windows (runs unattended, resumes if interrupted). This is what makes the impact table decision-grade."
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
            >
              <Scale className={clsx("size-3.5", job?.running && "animate-pulse")} /> {job?.running ? "Judging all…" : "Judge all windows"}
            </button>
          </>
        }
      />

      <SectionNav
        sections={[
          { id: "overview", label: "Overview" },
          { id: "outcome", label: "Outcome" },
          { id: "impact", label: "Impact" },
          ...((data.changePoints ?? []).length > 0 ? [{ id: "shifts", label: "Shifts" }] : []),
          { id: "adoptions", label: "Adoptions" },
        ]}
        summary={`${data.totalSessions} sessions · ${pct(data.signalCoverage)} signal`}
      />

      {err && <div className="card p-3 mb-4 text-sm text-err flex items-center gap-2"><AlertTriangle className="size-4" /> {err}</div>}
      {judgeMsg && <div className="card p-3 mb-4 text-sm text-fg-muted flex items-center gap-2"><Gavel className="size-4 text-accent-soft" /> {judgeMsg}</div>}
      {job && job.startedAt && (
        <div className="card p-3 mb-4 text-sm text-fg-muted">
          <div className="flex items-center gap-2">
            <Scale className={clsx("size-4 text-accent-soft shrink-0", job.running && "animate-pulse")} />
            {job.running
              ? <>Judging marker windows: <span className="mono tabular-nums text-fg">{job.done}/{job.total}</span>{job.failed > 0 && <span className="text-warn"> ({job.failed} failed)</span>} via {job.judge} — safe to leave this page.</>
              : <>Background judging finished: {job.judged}/{job.total} judged{job.failed > 0 && <span className="text-warn"> ({job.failed} failed{job.lastError ? ` — ${job.lastError}` : ""})</span>} via {job.judge}.</>}
          </div>
          {job.running && job.total > 0 && (
            <div className="mt-2 h-[5px] rounded-full bg-bg-elev overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.min(100, (job.done / job.total) * 100)}%`, background: "var(--color-accent)" }}
              />
            </div>
          )}
        </div>
      )}

      <section id="overview" className="scroll-mt-16 stagger-grid grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Sessions analyzed</div>
          <div className="text-lg mono font-semibold tabular-nums mt-0.5">{data.totalSessions}</div>
          <div className="text-[11px] text-fg-dim mono">{fmtDate(data.dateStart)} → {fmtDate(data.dateEnd)}</div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-fg-dim">
            {(["skill", "mcp", "subagent", "model"] as MarkerKind[]).map((k) => {
              const n = data.markers.filter((m) => m.kind === k).length;
              if (n === 0) return null;
              return (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
                  <span className="tabular-nums mono">{n}</span> {KIND_LABEL[k]}{n === 1 ? "" : "s"}
                </span>
              );
            })}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Outcome trend</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={clsx("text-lg mono font-semibold tabular-nums flex items-center gap-1", trend >= 0 ? "text-ok" : "text-err")}>
              <TrendIcon className="size-4" /> {signed(trend)}
            </span>
            <span className="text-[11px] text-fg-dim mono tabular-nums">{data.overall.firstHalfOutcome.toFixed(2)} → {data.overall.secondHalfOutcome.toFixed(2)}</span>
          </div>
          <div className="text-[11px] text-fg-dim">first half vs. second half (median)</div>
          <div className="mt-1.5 h-[5px] rounded-full bg-bg-elev overflow-hidden flex" aria-hidden>
            <div style={{ width: `${data.overall.firstHalfOutcome * 100}%`, background: "color-mix(in srgb, var(--color-accent) 35%, transparent)" }} />
          </div>
          <div className="mt-[3px] h-[5px] rounded-full bg-bg-elev overflow-hidden flex" aria-hidden>
            <div style={{ width: `${data.overall.secondHalfOutcome * 100}%`, background: "color-mix(in srgb, var(--color-accent) 75%, transparent)" }} />
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Signal coverage</div>
          <div className="text-lg mono font-semibold tabular-nums mt-0.5">{pct(data.signalCoverage)}</div>
          <div className="text-[11px] text-fg-dim">
            had an inferable outcome
            {data.judgedCoverage > 0 && <span className="text-accent-soft"> · {pct(data.judgedCoverage)} LLM-judged</span>}
          </div>
          <div
            className="mt-1.5 h-[5px] rounded-full bg-bg-elev overflow-hidden flex"
            title={`${pct(data.judgedCoverage)} LLM-judged · ${pct(Math.max(0, data.signalCoverage - data.judgedCoverage))} heuristic signal · ${pct(Math.max(0, 1 - data.signalCoverage))} no signal`}
          >
            <div style={{ width: `${data.judgedCoverage * 100}%`, background: "var(--color-accent)" }} />
            <div style={{ width: `${Math.max(0, data.signalCoverage - data.judgedCoverage) * 100}%`, background: "color-mix(in srgb, var(--color-accent) 35%, transparent)" }} />
          </div>
        </div>
      </section>

      <section id="outcome" className="scroll-mt-16 mb-6">
        <SectionHeader
          icon={LineChart}
          title="Outcome"
          desc="Inferred session outcomes over time, with every adoption and detected shift overlaid"
          right={`${data.outcomeSeries.length} sessions plotted`}
        />
        <div className="card p-4">
          <OutcomeChart series={data.outcomeSeries} markers={data.markers} changePoints={data.changePoints ?? []} />
        </div>
      </section>

      <section id="impact" className="scroll-mt-16 mb-6">
        <SectionHeader
          icon={GitCompareArrows}
          title="Impact"
          desc="Before vs. after each adoption — what actually moved when you started using it"
          right={`${data.impacts.length} measured`}
        />
        <div className="card overflow-hidden">
        <div className="px-3 py-2 text-[11px] text-fg-dim border-b border-bd/50">
          Median change in the ~20 sessions after first using each, vs. the ~20 before. <span className="text-warn">Correlational</span> — confounds (model changes, thin samples) are flagged.
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Adopted</th>
                <th className="num">Outcome Δ</th>
                <th className="num">Tool-err Δ</th>
                <th className="num">Cost Δ</th>
                <th className="num">Tools/turn Δ</th>
                <th className="pl-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.impacts.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-fg-dim text-sm">Not enough history around any adoption yet.</td></tr>
              )}
              {(() => {
                const maxDelta = Math.max(...data.impacts.map((x) => Math.abs(x.deltas.outcome)), 1e-9);
                return data.impacts.map((im) => {
                const Icon = KIND_ICON[im.marker.kind];
                return (
                  <tr key={`${im.marker.kind}-${im.marker.name}`} className={clsx(im.lowConfidence && "opacity-60")}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Icon className="size-3.5 shrink-0" style={{ color: KIND_COLOR[im.marker.kind] }} />
                        <span className="font-medium truncate max-w-[240px]">{im.marker.name}</span>
                      </div>
                      <div className="text-[10px] text-fg-dim mono">
                        {KIND_LABEL[im.marker.kind]} · {fmtDate(im.marker.firstSeenAt)} · n={im.nBefore}/{im.nAfter}
                        {(im.judgedBefore > 0 || im.judgedAfter > 0) && (
                          <span
                            className={clsx(im.judgedBefore >= 5 && im.judgedAfter >= 5 ? "text-accent-soft" : "text-fg-dim")}
                            title={im.judgedBefore >= 5 && im.judgedAfter >= 5
                              ? "Outcome medians on both sides use LLM-judged verdicts only"
                              : "Some sessions LLM-judged; medians switch to judged-only at 5 per side"}
                          > · judged {im.judgedBefore}/{im.judgedAfter}</span>
                        )}
                      </div>
                    </td>
                    <td className="num"><DeltaBar value={im.deltas.outcome} max={maxDelta} /></td>
                    <td className="num"><Delta value={im.deltas.toolErrorRate} lowerIsBetter fmt={(v) => signed(v * 100, 0) + "%"} /></td>
                    <td className="num"><Delta value={im.deltas.costUsd} lowerIsBetter fmt={(v) => "$" + v.toFixed(2)} /></td>
                    <td className="num"><Delta value={im.deltas.toolCallsPerTurn} lowerIsBetter fmt={(v) => signed(v, 1)} /></td>
                    <td className="pl-4">
                      {im.confounds.length > 0
                        ? <span className="text-[10px] text-warn flex items-center gap-1"><AlertTriangle className="size-3 shrink-0" /> {im.confounds[0]}</span>
                        : <span className="text-[10px] text-fg-dim">—</span>}
                    </td>
                  </tr>
                );
                });
              })()}
            </tbody>
          </table>
        </div>
        </div>
      </section>

      {(data.changePoints ?? []).length > 0 && (
        <section id="shifts" className="scroll-mt-16 mb-6">
          <SectionHeader
            icon={Zap}
            title="Shifts"
            desc="Statistical level changes in your metrics, found without assuming a cause"
            right={`${(data.changePoints ?? []).length} detected`}
          />
          <div className="card overflow-hidden">
          <div className="px-3 py-2 text-[11px] text-fg-dim border-b border-bd/50">
            Statistical change points (two-window mean shift, z ≥ 3), found without assuming any cause. Markers first seen within ±7 days are listed as suspects.
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Metric</th>
                  <th className="num">Before → after</th>
                  <th className="num">z</th>
                  <th className="pl-4">Possible cause</th>
                </tr>
              </thead>
              <tbody>
                {(data.changePoints ?? []).map((cp) => {
                  const lowerIsBetter = cp.metric !== "outcome";
                  const good = lowerIsBetter ? cp.delta < 0 : cp.delta > 0;
                  const fmt = (v: number) => (cp.metric === "costUsd" ? "$" + v.toFixed(2) : cp.metric === "toolErrorRate" ? (v * 100).toFixed(0) + "%" : v.toFixed(2));
                  const metricLabel = cp.metric === "toolErrorRate" ? "tool errors" : cp.metric === "costUsd" ? "cost / session" : "outcome";
                  const metricColor = cp.metric === "toolErrorRate" ? "var(--color-err)" : cp.metric === "costUsd" ? "var(--color-warn)" : "var(--color-accent-soft)";
                  return (
                    <tr key={`${cp.metric}-${cp.at}`}>
                      <td className="mono text-[12px] text-fg-muted tabular-nums">{fmtDate(cp.at)}</td>
                      <td>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
                          style={{ color: metricColor, background: `color-mix(in srgb, ${metricColor} 12%, transparent)` }}
                        >
                          <span className="size-1.5 rounded-full" style={{ background: metricColor }} />
                          {metricLabel}
                        </span>
                      </td>
                      <td className={clsx("num", good ? "text-ok" : "text-err")}>
                        <span className="text-fg-dim">{fmt(cp.before)}</span> → {fmt(cp.after)}
                      </td>
                      <td className="num text-fg-dim">{cp.zScore.toFixed(1)}</td>
                      <td className="pl-4 text-[11px] text-fg-muted">
                        {cp.nearMarkers.length ? cp.nearMarkers.join(" · ") : <span className="text-fg-dim">unattributed — nothing new adopted nearby</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </section>
      )}

      <section id="adoptions" className="scroll-mt-16">
        <SectionHeader
          icon={CalendarPlus}
          title="Adoptions"
          desc="Every skill, plugin, subagent, and model — the day it first appeared in your workflow"
          right={`${data.markers.length} total`}
        />
        <div className="card overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto px-4 py-3">
          {(() => {
            // Newest first, grouped by month; each group renders on a shared rail.
            const groups: Array<{ label: string; items: typeof data.markers }> = [];
            for (const m of [...data.markers].reverse()) {
              const label = new Date(m.firstSeenAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
              const last = groups[groups.length - 1];
              if (last && last.label === label) last.items.push(m);
              else groups.push({ label, items: [m] });
            }
            return groups.map((g) => (
              <div key={g.label} className="relative pl-4">
                {/* rail */}
                <div className="absolute left-[3px] top-1 bottom-0 w-px bg-bd/60" aria-hidden />
                <div className="sticky top-0 z-[1] -ml-4 pl-4 py-1 bg-bg-subtle text-[10px] uppercase tracking-wider text-fg-muted">
                  {g.label}
                </div>
                <ul>
                  {g.items.map((m) => {
                    const Icon = KIND_ICON[m.kind];
                    return (
                      <li key={`${m.kind}-${m.name}`} className="relative py-1 group">
                        <span
                          className="absolute -left-[15px] top-[9px] size-[7px] rounded-full ring-2 ring-bg-subtle"
                          style={{ background: KIND_COLOR[m.kind] }}
                          aria-hidden
                        />
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="mono text-[10px] text-fg-dim tabular-nums shrink-0 w-14">{fmtDate(m.firstSeenAt).slice(5)}</span>
                          <Icon className="size-3 shrink-0" style={{ color: KIND_COLOR[m.kind] }} />
                          <span className="truncate text-[13px] text-fg group-hover:text-accent-soft transition-colors">{m.name}</span>
                          <span className="ml-auto shrink-0 mono text-[10px] text-fg-dim tabular-nums" title={`used in ${m.sessionCount} session${m.sessionCount === 1 ? "" : "s"}`}>
                            ×{m.sessionCount}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ));
          })()}
        </div>
        </div>
      </section>
    </div>
  );
}
