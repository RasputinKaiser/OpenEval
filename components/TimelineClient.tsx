"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Activity, TrendingUp, TrendingDown, AlertTriangle, ArrowLeft, Puzzle, Plug, Users, Sparkles, Gavel, Scale } from "lucide-react";
import PageHeader from "./PageHeader";
import { fmtDate, fmtPct as pct, fmtSigned as signed } from "@/lib/format";
import type { TimelineReport } from "@/lib/insights/collect";
import type { MarkerKind } from "@/lib/insights/timeline";
import type { JudgeJobStatus } from "@/lib/insights/judge";

const KIND_ICON: Record<MarkerKind, typeof Puzzle> = { skill: Sparkles, mcp: Plug, subagent: Users, model: Activity };
const KIND_LABEL: Record<MarkerKind, string> = { skill: "skill", mcp: "plugin", subagent: "subagent", model: "model" };

/** A colored delta chip. `lowerIsBetter` flips the good/bad coloring. */
function Delta({ value, lowerIsBetter, fmt }: { value: number; lowerIsBetter?: boolean; fmt: (v: number) => string }) {
  const good = lowerIsBetter ? value < 0 : value > 0;
  const bad = lowerIsBetter ? value > 0 : value < 0;
  const tone = Math.abs(value) < 1e-9 ? "text-fg-dim" : good ? "text-ok" : bad ? "text-err" : "text-fg-dim";
  return <span className={clsx("mono tabular-nums", tone)}>{fmt(value)}</span>;
}

function Sparkline({ series }: { series: TimelineReport["outcomeSeries"] }) {
  if (series.length < 2) return null;
  const w = 260, h = 40, pad = 3;
  const xs = series.map((_, i) => pad + (i / (series.length - 1)) * (w - 2 * pad));
  const ys = series.map((p) => h - pad - p.value * (h - 2 * pad)); // value 0..1
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[280px] h-10">
      <line x1={pad} y1={h - pad - 0.5 * (h - 2 * pad)} x2={w - pad} y2={h - pad - 0.5 * (h - 2 * pad)} stroke="currentColor" className="text-bd" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="currentColor" className="text-accent-soft" strokeWidth={1.5} />
    </svg>
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

      {err && <div className="card p-3 mb-4 text-sm text-err flex items-center gap-2"><AlertTriangle className="size-4" /> {err}</div>}
      {judgeMsg && <div className="card p-3 mb-4 text-sm text-fg-muted flex items-center gap-2"><Gavel className="size-4 text-accent-soft" /> {judgeMsg}</div>}
      {job && job.startedAt && (
        <div className="card p-3 mb-4 text-sm text-fg-muted flex items-center gap-2">
          <Scale className={clsx("size-4 text-accent-soft", job.running && "animate-pulse")} />
          {job.running
            ? <>Judging marker windows: <span className="mono tabular-nums">{job.done}/{job.total}</span>{job.failed > 0 && <span className="text-warn"> ({job.failed} failed)</span>} via {job.judge} — safe to leave this page.</>
            : <>Background judging finished: {job.judged}/{job.total} judged{job.failed > 0 && <span className="text-warn"> ({job.failed} failed{job.lastError ? ` — ${job.lastError}` : ""})</span>} via {job.judge}.</>}
        </div>
      )}

      <section className="stagger-grid grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Sessions analyzed</div>
          <div className="text-lg mono font-semibold tabular-nums mt-0.5">{data.totalSessions}</div>
          <div className="text-[11px] text-fg-dim">{fmtDate(data.dateStart)} → {fmtDate(data.dateEnd)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Outcome trend</div>
          <div className={clsx("text-lg mono font-semibold tabular-nums mt-0.5 flex items-center gap-1", trend >= 0 ? "text-ok" : "text-err")}>
            <TrendIcon className="size-4" /> {signed(trend)}
          </div>
          <div className="text-[11px] text-fg-dim">{data.overall.firstHalfOutcome.toFixed(2)} → {data.overall.secondHalfOutcome.toFixed(2)} (median)</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Signal coverage</div>
          <div className="text-lg mono font-semibold tabular-nums mt-0.5">{pct(data.signalCoverage)}</div>
          <div className="text-[11px] text-fg-dim">
            had an inferable outcome
            {data.judgedCoverage > 0 && <span className="text-accent-soft"> · {pct(data.judgedCoverage)} LLM-judged</span>}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Outcome over time</div>
          <Sparkline series={data.outcomeSeries} />
        </div>
      </section>

      <section className="card overflow-hidden mb-5">
        <div className="px-3 py-2 border-b border-bd text-[11px] uppercase tracking-wider text-fg-muted">Adoption impact — before vs. after</div>
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
              {data.impacts.map((im) => {
                const Icon = KIND_ICON[im.marker.kind];
                return (
                  <tr key={`${im.marker.kind}-${im.marker.name}`}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Icon className="size-3.5 text-fg-dim shrink-0" />
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
                    <td className="num"><Delta value={im.deltas.outcome} fmt={(v) => signed(v)} /></td>
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
              })}
            </tbody>
          </table>
        </div>
      </section>

      {(data.changePoints ?? []).length > 0 && (
        <section className="card overflow-hidden mb-5">
          <div className="px-3 py-2 border-b border-bd text-[11px] uppercase tracking-wider text-fg-muted">Detected shifts — level changes in your metrics</div>
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
                  return (
                    <tr key={`${cp.metric}-${cp.at}`}>
                      <td className="mono text-[12px] text-fg-muted tabular-nums">{fmtDate(cp.at)}</td>
                      <td className="text-[12px]">{cp.metric === "toolErrorRate" ? "tool errors" : cp.metric === "costUsd" ? "cost / session" : "outcome"}</td>
                      <td className={clsx("num", good ? "text-ok" : "text-err")}>{fmt(cp.before)} → {fmt(cp.after)}</td>
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
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="px-3 py-2 border-b border-bd text-[11px] uppercase tracking-wider text-fg-muted">Adoption timeline — first seen</div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>First seen</th>
                <th>Type</th>
                <th>Name</th>
                <th className="num">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {[...data.markers].reverse().map((m) => {
                const Icon = KIND_ICON[m.kind];
                return (
                  <tr key={`${m.kind}-${m.name}`}>
                    <td className="mono text-[12px] text-fg-muted tabular-nums">{fmtDate(m.firstSeenAt)}</td>
                    <td><span className="inline-flex items-center gap-1 text-[10px] text-fg-dim"><Icon className="size-3" /> {KIND_LABEL[m.kind]}</span></td>
                    <td className="truncate max-w-[360px]">{m.name}</td>
                    <td className="num text-fg-muted">{m.sessionCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
