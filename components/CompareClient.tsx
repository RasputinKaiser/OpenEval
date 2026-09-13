"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, GitCompareArrows, Loader2 } from "lucide-react";
import PageHeader from "./PageHeader";
import { presentSummaryCost } from "@/lib/cost-display";
import { fmtNum, fmtNumFull, fmtPct as fmtPctStrict } from "@/lib/format";
import EvaluateNav from "./EvaluateNav";
import EvaluationProfile from "./EvaluationProfile";
import VisualComparisonStage from "./VisualComparisonStage";
import ExperimentPanel from "./ExperimentPanel";
import { CompareCharts } from "./CompareCharts";
import { comparisonKey, transitionKey } from "@/lib/comparison-analysis";

/** Sticky first column: case identity stays put while deltas scroll on narrow screens. */
const STICKY_TH = "sticky left-0 z-[2] bg-bg-subtle";
const STICKY_TD = "sticky left-0 z-[1] bg-bg-subtle";

interface RunLite { id: string; name: string; createdAt: number; status: string; passRate: number | null; model?: string; }
interface Props { runs: RunLite[]; initialA?: string; initialB?: string; }

interface CaseRow { caseId: string; sample: number; caseName: string; category: string; difficulty?: string;
  aStatus: string | null; bStatus: string | null;
  aTokPerSec: number | null; bTokPerSec: number | null; aCost: number | null; bCost: number | null; aTurns: number | null; bTurns: number | null;
  aCaseRef: string | null; bCaseRef: string | null;
  aCostSource?: string; bCostSource?: string;
  aModel?: string | null; bModel?: string | null;
  aVisualArtifacts: string[]; bVisualArtifacts: string[]; }

export default function CompareClient({ runs, initialA, initialB }: Props) {
  const [a, setA] = useState(initialA || runs[0]?.id || "");
  const [b, setB] = useState(initialB || runs[1]?.id || "");
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [summaryA, setSummaryA] = useState<any>(null);
  const [summaryB, setSummaryB] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "regressions" | "improvements">("all");

  const [transitionFilter, setTransitionFilter] = useState<string | null>(null);
  const [caseFilter, setCaseFilter] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => { setA(initialA || runs[0]?.id || ""); setB(initialB || runs[1]?.id || ""); }, [initialA, initialB, runs]);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setA(params.get("a") ?? initialA ?? runs[0]?.id ?? "");
      setB(params.get("b") ?? initialB ?? runs[1]?.id ?? "");
      const view = params.get("cmpView"); setViewMode(view === "regressions" || view === "improvements" ? view : "all");
      setTransitionFilter(params.get("cmpTransition")); setCaseFilter(params.get("cmpCase"));
    };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [initialA, initialB, runs]);
  const chooseRun = (side: "a" | "b", value: string) => {
    if (side === "a") setA(value); else setB(value);
    const url = new URL(window.location.href); url.searchParams.set("a", side === "a" ? value : a); url.searchParams.set("b", side === "b" ? value : b);
    for (const key of ["cmpCase", "cmpTransition", "cmpView"]) url.searchParams.delete(key);
    setTransitionFilter(null); setCaseFilter(null); setViewMode("all");
    window.history.pushState(null, "", url);
  };
  const applyFilter = (view: typeof viewMode, transition: string | null, caseKey: string | null) => {
    setViewMode(view); setTransitionFilter(transition); setCaseFilter(caseKey);
    const url = new URL(window.location.href);
    for (const [key, value] of [["cmpView", view === "all" ? null : view], ["cmpTransition", transition], ["cmpCase", caseKey]] as const) {
      if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
    }
    url.searchParams.set("a", a); url.searchParams.set("b", b);
    window.history.pushState(null, "", url);
  };

  useEffect(() => {
    if (!a || !b || a === b) { setRows([]); setSummaryA(null); setSummaryB(null); setLoadError(null); setLoading(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    // Do not leave the previous pair's evidence visible while a newly
    // selected pair is loading. That briefly misattributes deltas to B.
    setRows([]);
    setSummaryA(null);
    setSummaryB(null);
    const get = (id: string) => fetch(`/api/runs/${encodeURIComponent(id)}?lite=1`, { signal: controller.signal }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} loading run ${id}`);
      return r.json();
    });
    Promise.all([get(a), get(b)]).then(([da, db]: [any, any]) => {
      if (cancelled) return;
      setSummaryA(da.run?.summary);
      setSummaryB(db.run?.summary);
      // Key by case AND sample so pass@k runs diff sample-to-sample instead of
      // collapsing to whichever sample was inserted last.
      const keyOf = (c: any) => `${c.case_id}::${c.sample ?? 0}`;
      const mapA = new Map<string, any>((da.cases || []).map((c: any) => [keyOf(c), c]));
      const mapB = new Map<string, any>((db.cases || []).map((c: any) => [keyOf(c), c]));
      const keys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
      const out: CaseRow[] = [];
      const artifactsOf = (c: any): string[] => Array.isArray(c?.case_def?.visual?.expected_artifacts)
        ? c.case_def.visual.expected_artifacts.filter((path: unknown): path is string => typeof path === "string")
        : [];
      for (const key of keys) {
        const ca = mapA.get(key); const cb = mapB.get(key);
        const src = cb || ca;
        const rate = outputRate(ca);
        const rateB = outputRate(cb);
        out.push({
          caseId: src.case_id,
          sample: src.sample ?? 0,
          caseName: src?.case_name || src.case_id,
          category: src?.category || "",
          difficulty: src?.difficulty,
          aStatus: ca?.status ?? null,
          bStatus: cb?.status ?? null,
          aTokPerSec: rate, bTokPerSec: rateB,
          aCost: costValue(ca),
          bCost: costValue(cb),
          aCostSource: ca?.runner_result?.usage?.costSource ?? "unspecified",
          bCostSource: cb?.runner_result?.usage?.costSource ?? "unspecified",
          aTurns: runnerValue(ca, "numTurns"),
          bTurns: runnerValue(cb, "numTurns"),
          aCaseRef: ca?.id ?? ca?.case_id ?? null,
          bCaseRef: cb?.id ?? cb?.case_id ?? null,
          aModel: ca?.runner_result?.model, bModel: cb?.runner_result?.model,
          aVisualArtifacts: artifactsOf(ca), bVisualArtifacts: artifactsOf(cb),
        });
      }
      out.sort((x, y) => cmp(x.caseName, y.caseName) || x.sample - y.sample);
      setRows(out);
    }).catch((e) => {
      // Never surface a failed poll as a runtime overlay — show a stale-data
      // banner, and drop the previous pair's summaries so their deltas can't
      // be misattributed to the newly selected runs.
      if (!cancelled) { setRows([]); setSummaryA(null); setSummaryB(null); setLoadError(e instanceof Error ? e.message : String(e)); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [a, b, retry]);

  const regressions = rows.filter((r) => r.aStatus === "passed" && r.bStatus && r.bStatus !== "passed");
  const improvements = rows.filter((r) => r.aStatus && r.aStatus !== "passed" && r.bStatus === "passed");
  const sampleCounts = new Map<string, number>();
  for (const row of rows) sampleCounts.set(row.caseId, (sampleCounts.get(row.caseId) ?? 0) + 1);
  const multiSample = new Set([...sampleCounts].filter(([, count]) => count > 1).map(([caseId]) => caseId));
  const visualRows = rows.filter((row) => row.aVisualArtifacts.length > 0 || row.bVisualArtifacts.length > 0);
  const comparableVisualCount = visualRows.filter((row) => row.aVisualArtifacts.length > 0 && row.bVisualArtifacts.length > 0).length;
  const filteredRows = (viewMode === "regressions" ? regressions : viewMode === "improvements" ? improvements : rows).filter((row) => (!transitionFilter || transitionKey(row) === transitionFilter) && (!caseFilter || comparisonKey(row) === caseFilter));
  const runA = runs.find((run) => run.id === a);
  const runB = runs.find((run) => run.id === b);
  const sharedCohort = filteredRows.filter((row) => row.aCaseRef !== null && row.bCaseRef !== null).map((row) => ({ caseId: row.caseId, sample: row.sample, caseName: row.caseName, aStatus: row.aStatus, bStatus: row.bStatus }));

  return (
    <div className="p-4 md:p-8 w-full">
      <PageHeader icon={GitCompareArrows} title="Evaluation lab" subtitle="Compare run results, check their supporting evidence, and view outputs side by side." />
      <EvaluateNav />

      {runs.length >= 2 && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <RunSelect label="Baseline A" value={a} onChange={(value) => chooseRun("a", value)} runs={runs} />
            <ArrowRight className="size-4 text-fg-dim mb-3 hidden md:block" />
            <RunSelect label="Comparison B" value={b} onChange={(value) => chooseRun("b", value)} runs={runs} />
          </div>
        </div>
      )}



      {loadError && (
        <div className="mb-4 rounded-lg border border-err/40 bg-err/10 p-3 flex items-start gap-2.5" role="alert">
          <AlertTriangle className="size-4 text-err shrink-0 mt-0.5" />
          <div className="min-w-0 text-sm">
            <span className="font-medium text-err">Couldn&apos;t load the diff</span>
            <span className="text-fg-muted"> — {loadError}.</span><button type="button" className="analysis-control ml-2" onClick={() => setRetry(retry + 1)}>Retry comparison</button>
          </div>
        </div>
      )}

      {a && b && a !== b && summaryA && summaryB && (
        <>
          <div aria-label="Outcome profile">
            <EvaluationProfile
              baseline={{ name: runA?.name ?? a, summary: summaryA }}
              comparison={{ name: runB?.name ?? b, summary: summaryB }}
              visualContractCount={visualRows.length}
              comparableVisualCount={comparableVisualCount}
            />
          </div>
          {visualRows.length > 0 && (
            <VisualComparisonStage
              baseline={{ id: a, name: runA?.name ?? a, status: runA?.status ?? "" }}
              comparison={{ id: b, name: runB?.name ?? b, status: runB?.status ?? "" }}
              rows={visualRows}
            />
          )}
          <section className="stagger-grid grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Delta label="Pass rate" a={fmtPctStrict(summaryA.passRate)} b={fmtPctStrict(summaryB.passRate)} higherIsBetter aVal={summaryA.passRate} bVal={summaryB.passRate} />
            <Delta label="pass@1" a={fmtPct(summaryA.passAt1)} b={fmtPct(summaryB.passAt1)} aVal={summaryA.passAt1} bVal={summaryB.passAt1} higherIsBetter hint={`95% CI ${fmtCi(summaryA.passAt1Ci95)} → ${fmtCi(summaryB.passAt1Ci95)}`} />
            <Delta label="pass@k" a={fmtPct(summaryA.passAtK)} b={fmtPct(summaryB.passAtK)} aVal={summaryA.passAtK} bVal={summaryB.passAtK} />
            <Delta label="pass^k (reliability)" a={fmtPct(summaryA.passPowK)} b={fmtPct(summaryB.passPowK)} aVal={summaryA.passPowK} bVal={summaryB.passPowK} />
            <Delta label="Cost coverage" a={presentSummaryCost(summaryA).value} b={presentSummaryCost(summaryB).value} aVal={summaryA.totalCostUsd} bVal={summaryB.totalCostUsd} lowerIsBetter comparable={(summaryA.missingCostCases ?? 0) === 0 && (summaryB.missingCostCases ?? 0) === 0} />
            <Delta label="Avg output tok/s" a={formatRate(summaryOutputRate(summaryA))} b={formatRate(summaryOutputRate(summaryB))} aVal={summaryOutputRate(summaryA)} bVal={summaryOutputRate(summaryB)} higherIsBetter />
            <Delta label="Tokens in" a={fmtNum(summaryA.totalTokensIn)} b={fmtNum(summaryB.totalTokensIn)} aVal={summaryA.totalTokensIn} bVal={summaryB.totalTokensIn} lowerIsBetter fmtDiff={(d) => fmtNum(d)} hint={`${fmtNumFull(summaryA.totalTokensIn)} → ${fmtNumFull(summaryB.totalTokensIn)}`} />
            <Delta label="Errors" a={String(summaryA.errored)} b={String(summaryB.errored)} aVal={summaryA.errored} bVal={summaryB.errored} lowerIsBetter />
          </section>
        </>
      )}

      {loading && <div role="status" aria-live="polite" className="text-sm text-fg-muted mb-4 flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Loading diff…</div>}

      {runs.length === 0 && (
        <section className="card p-10 text-center">
          <div className="text-sm font-medium mb-1">No runs to compare yet</div>
          <div className="text-sm text-fg-muted">A comparison needs two finished runs. Start a run, then re-run the same suite with a different harness, model, or commit to diff them here.</div>
          <Link href="/runs/new" className="mt-3 inline-flex text-xs text-accent-soft hover:underline">Start your first run →</Link>
        </section>
      )}

      {runs.length === 1 && (
        <section className="card p-10 text-center">
          <div className="text-sm font-medium mb-1">Only one run so far</div>
          <div className="text-sm text-fg-muted">
            Comparing needs a second run as the other side of the diff — typically the same suite on a different harness, model, or after a code change.
          </div>
          <Link href="/runs/new" className="mt-3 inline-flex text-xs text-accent-soft hover:underline">Start a second run →</Link>
        </section>
      )}

      {runs.length >= 2 && (!a || !b) && (
        <section className="card p-6 text-center text-sm text-fg-muted">
          Select a baseline (A) and a comparison (B) above — usually the older run as A and the newer as B. The diff highlights per-case regressions, improvements, and speed/cost deltas.
        </section>
      )}

      {a && b && a === b && (
        <section className="card p-6 text-center text-sm text-fg-muted">
          Both sides point at the same run. Pick two different runs to compute a useful diff.
        </section>
      )}

      {a && b && a !== b && !loading && !loadError && rows.length === 0 && (summaryA || summaryB) && (
        <section className="card p-6 text-center text-sm text-fg-muted">
          These runs share no graded cases yet, so there is nothing to diff.
        </section>
      )}

      {a && b && a !== b && rows.length > 0 && (
        <>
          <CompareCharts rows={rows} onTransition={(key) => applyFilter("all", key, null)} onCase={(key) => applyFilter("all", null, key)} />
          <div className="flex flex-wrap gap-3 mb-3 text-xs items-center">
            <div className="flex gap-1">
              <button type="button" onClick={() => applyFilter("all", null, null)} aria-pressed={viewMode === "all"} className={clsx("min-h-10 px-2.5 py-1 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", viewMode === "all" ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev")}>All</button>
              <button type="button" onClick={() => applyFilter("regressions", null, null)} aria-pressed={viewMode === "regressions"} className={clsx("min-h-10 px-2.5 py-1 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", viewMode === "regressions" ? "border-err bg-err/10 text-err" : "border-bd text-fg-muted hover:bg-bg-elev")}>▼ {regressions.length} regression{regressions.length !== 1 ? "s" : ""}</button>
              <button type="button" onClick={() => applyFilter("improvements", null, null)} aria-pressed={viewMode === "improvements"} className={clsx("min-h-10 px-2.5 py-1 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", viewMode === "improvements" ? "border-ok bg-ok/10 text-ok" : "border-bd text-fg-muted hover:bg-bg-elev")}>▲ {improvements.length} improvement{improvements.length !== 1 ? "s" : ""}</button>
            </div>
          </div>
          {(transitionFilter || caseFilter) && <div className="flex flex-wrap items-center gap-2 mb-3 text-xs" aria-label="Active comparison filters"><span>{filteredRows.length} / {rows.length} case/sample pairs match the chart selection.</span><button type="button" className="analysis-control" onClick={() => applyFilter("all", null, null)}>Remove chart selection</button></div>}
          <section className="card overflow-hidden">
            <div className="chart-scroll-well overflow-x-auto pb-2" role="region" tabIndex={0} aria-label="Matched case and sample evidence">
              <table className="w-full text-sm">
                <caption className="sr-only">Per-case comparison. Delta is comparison B minus baseline A; an em dash means the metric is missing on one or both sides.</caption>
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-[0.12em] text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                  <tr>
                    <th className={clsx("text-left px-4 py-2 font-medium", STICKY_TH)}>Case</th>
                    <th className="text-left px-4 py-2 font-medium">A</th>
                    <th className="text-left px-4 py-2 font-medium">B</th>
                    <th className="text-right px-4 py-2 font-medium">Output tok/s Δ</th>
                    <th className="text-right px-4 py-2 font-medium">Estimated cost (USD) Δ</th>
                    <th className="text-right px-4 py-2 font-medium">Turns Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {!filteredRows.length && <tr><td colSpan={6} className="p-4 text-sm text-fg-muted">No case/sample pairs match the current filters.</td></tr>}
                  {filteredRows.map((r) => {
                    const regressed = r.aStatus === "passed" && r.bStatus && r.bStatus !== "passed";
                    const improved = r.aStatus && r.aStatus !== "passed" && r.bStatus === "passed";
                    return (
                      <tr key={`${r.caseId}::${r.sample}`} className={clsx(regressed && "bg-err/5", improved && "bg-ok/5", "hover:bg-bg-elev")}>
                        <td className={clsx("px-4 py-2 pl-3 relative max-w-[220px] md:max-w-none", STICKY_TD)}>
                          {(regressed || improved) && (
                            <div className={clsx("absolute left-0 top-0 bottom-0 w-0.5", regressed ? "bg-err" : "bg-ok")} />
                          )}
                          <Link
                            href={`/runs/${r.bCaseRef ? b : a}/case/${r.bCaseRef ?? r.aCaseRef ?? r.caseId}`}
                            aria-label={`Open ${r.caseName} sample ${r.sample} evidence`}
                            className="hover:text-accent-soft block truncate"
                          >{r.caseName}</Link>
                          <div className="text-[10px] text-fg-dim mono truncate">{r.caseId}{multiSample.has(r.caseId) ? ` · sample ${r.sample}` : ""} · {r.category}{r.difficulty ? ` · ${r.difficulty}` : ""}</div>
                        </td>
                        <td className="px-4 py-2"><StatusLink runId={a} caseId={r.aCaseRef ?? r.caseId} caseName={r.caseName} side="baseline A" status={r.aStatus} /></td>
                        <td className="px-4 py-2"><StatusLink runId={b} caseId={r.bCaseRef ?? r.caseId} caseName={r.caseName} side="comparison B" status={r.bStatus} /></td>
                        <td className="px-4 py-2 text-right mono"><MetricDelta a={r.aTokPerSec} b={r.bTokPerSec} digits={1} higherIsBetter label="output throughput" /></td>
                        <td className="px-4 py-2 text-right mono"><MetricDelta a={r.aCost} b={r.bCost} digits={4} prefix="$" lowerIsBetter label="estimated cost" /></td>
                        <td className="px-4 py-2 text-right mono"><MetricDelta a={r.aTurns} b={r.bTurns} digits={0} lowerIsBetter label="turn count" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <details className="mt-6"><summary className="analysis-control cursor-pointer">Save or review an experiment</summary>
      <ExperimentPanel baselineRunId={a} candidateRunId={b} baselineName={runA?.name ?? a} candidateName={runB?.name ?? b} sharedCohort={sharedCohort} />
      </details>
    </div>
  );
}

function RunSelect({ label, value, onChange, runs }: { label: string; value: string; onChange: (v: string) => void; runs: RunLite[] }) {
  const id = label === "Baseline A" ? "compare-baseline-a" : "compare-comparison-b";
  return (
    <div>
      <label htmlFor={id} className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 min-h-11 w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent">
        <option value="">Select run…</option>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id}){r.model ? ` · ${r.model}` : ""}{r.passRate != null ? ` · ${(r.passRate * 100).toFixed(0)}%` : ""}</option>)}
      </select>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-fg-dim text-xs">—</span>;
  const colors: Record<string, string> = {
    passed: "bg-ok/10 text-ok border-ok/20",
    failed: "bg-err/10 text-err border-err/20",
    error: "bg-err/10 text-err border-err/20",
    running: "bg-accent/10 text-accent-soft border-accent/20",
    grading: "bg-warn/10 text-warn border-warn/20",
    pending: "bg-bg-elev text-fg-dim border-bd",
    skipped: "bg-bg-elev text-fg-dim border-bd",
  };
  const cls = colors[status] ?? "bg-bg-elev text-fg-muted border-bd";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] mono", cls)}>
      <span className={clsx("size-1.5 rounded-full", status === "passed" ? "bg-ok" : status === "failed" || status === "error" ? "bg-err" : status === "running" ? "bg-accent-soft" : status === "grading" ? "bg-warn" : "bg-fg-dim")} />
      {status}
    </span>
  );
}

function StatusLink({ runId, caseId, caseName, side, status }: { runId: string; caseId: string; caseName: string; side: string; status: string | null }) {
  if (!status) return <StatusPill status={status} />;
  return <Link href={`/runs/${encodeURIComponent(runId)}/case/${encodeURIComponent(caseId)}`} aria-label={`Open ${caseName} in ${side}`}><StatusPill status={status} /></Link>;
}

function MetricDelta({ a, b, digits, prefix, higherIsBetter, lowerIsBetter, label }: { a: number | null; b: number | null; digits: number; prefix?: string; higherIsBetter?: boolean; lowerIsBetter?: boolean; label: string }) {
  if (a == null || b == null) {
    const missing = a == null && b == null ? "both runs" : a == null ? "baseline A" : "comparison B";
    return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-fg-dim" title={`Not comparable: ${label} evidence is missing on ${missing}.`} aria-label={`Not comparable: ${label} evidence is missing on ${missing}`}>—</span>;
  }
  return <DeltaText value={b - a} digits={digits} prefix={prefix} higherIsBetter={higherIsBetter} lowerIsBetter={lowerIsBetter} />;
}

function DeltaText({ value, digits, prefix = "", higherIsBetter, lowerIsBetter }: { value: number; digits: number; prefix?: string; higherIsBetter?: boolean; lowerIsBetter?: boolean }) {
  let tone = "text-fg-muted";
  let bg = "";
  let arrow = "";
  if (higherIsBetter) {
    tone = value > 0 ? "text-ok" : value < 0 ? "text-err" : "text-fg-muted";
    bg = value > 0 ? "bg-ok/10" : value < 0 ? "bg-err/10" : "";
    arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  }
  if (lowerIsBetter) {
    tone = value < 0 ? "text-ok" : value > 0 ? "text-err" : "text-fg-muted";
    bg = value < 0 ? "bg-ok/10" : value > 0 ? "bg-err/10" : "";
    arrow = value < 0 ? "▼" : value > 0 ? "▲" : "";
  }
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 mono tabular-nums text-xs", tone, bg)}>
      {arrow && <span className="text-[9px]">{arrow}</span>}
      {value > 0 ? "+" : ""}{prefix}{value.toFixed(digits)}
    </span>
  );
}

function Delta({ label, a, b, aVal, bVal, higherIsBetter, lowerIsBetter, comparable = true, hint, fmtDiff }: { label: string; a: string; b: string; aVal?: number | null; bVal?: number | null; higherIsBetter?: boolean; lowerIsBetter?: boolean; comparable?: boolean; hint?: string; fmtDiff?: (d: number) => string }) {
  const comparableValues = comparable && aVal != null && bVal != null && Number.isFinite(aVal) && Number.isFinite(bVal);
  const diff = comparableValues ? bVal - aVal : null;
  let tone = "text-fg-muted";
  let bgTone = "";
  let arrow = "";
  if (diff != null && higherIsBetter) {
    tone = diff > 0 ? "text-ok" : diff < 0 ? "text-err" : "text-fg-muted";
    bgTone = diff > 0 ? "bg-ok/5" : diff < 0 ? "bg-err/5" : "";
    arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "";
  }
  if (diff != null && lowerIsBetter) {
    tone = diff < 0 ? "text-ok" : diff > 0 ? "text-err" : "text-fg-muted";
    bgTone = diff < 0 ? "bg-ok/5" : diff > 0 ? "bg-err/5" : "";
    arrow = diff < 0 ? "▼" : diff > 0 ? "▲" : "";
  }
  return (
    <div className={clsx("card p-3", bgTone)}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm mono text-fg-muted tabular-nums">{a}</span>
        <span className="text-fg-dim">→</span>
        <span className="text-sm mono font-medium tabular-nums">{b}</span>
      </div>
      <div className={clsx("text-[11px] mono mt-0.5 tabular-nums", tone)}>{diff != null ? `${arrow} ${diff > 0 ? "+" : ""}${fmtDiff ? fmtDiff(diff) : diff.toFixed(2)}` : "incomplete coverage — not comparable"}</div>
      {hint && <div className="text-[10px] mono text-fg-dim mt-0.5 tabular-nums">{hint}</div>}
    </div>
  );
}

function fmtCi(ci?: { lo: number; hi: number }): string {
  return ci && Number.isFinite(ci.lo) && Number.isFinite(ci.hi) ? `${(ci.lo * 100).toFixed(0)}–${(ci.hi * 100).toFixed(0)}%` : "—";
}

function fmtPct(x?: number) { return x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(0)}%`; }
function cmp(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function outputRate(caseData: any): number | null {
  const durationMs = numeric(caseData?.runner_result?.durationMs);
  const outputTokens = numeric(caseData?.runner_result?.usage?.outputTokens);
  if (durationMs == null || durationMs <= 0 || outputTokens == null) return null;
  return outputTokens / (durationMs / 1000);
}

function costValue(caseData: any): number | null {
  const source = caseData?.runner_result?.usage?.costSource;
  const cost = numeric(caseData?.runner_result?.usage?.costUsd);
  return source === "missing" || cost == null ? null : cost;
}

function runnerValue(caseData: any, key: "numTurns"): number | null {
  return caseData?.runner_result ? numeric(caseData.runner_result[key]) : null;
}

function summaryOutputRate(summary: any): number | null {
  const output = numeric(summary?.totalTokensOut);
  const durationMs = numeric(summary?.totalDurationMs);
  return output != null && durationMs != null && durationMs > 0 ? output / (durationMs / 1000) : null;
}

function formatRate(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} tok/s`;
}
