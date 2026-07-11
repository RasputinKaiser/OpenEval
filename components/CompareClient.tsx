"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, GitCompareArrows, Loader2 } from "lucide-react";
import PageHeader from "./PageHeader";

interface RunLite { id: string; name: string; createdAt: number; status: string; passRate: number | null; model?: string; }
interface Props { runs: RunLite[]; initialA?: string; initialB?: string; }

interface CaseRow { caseId: string; caseName: string; category: string; difficulty?: string;
  aStatus: string | null; bStatus: string | null;
  aTokPerSec: number; bTokPerSec: number; aCost: number; bCost: number; aTurns: number; bTurns: number;
  aModel?: string | null; bModel?: string | null; }

export default function CompareClient({ runs, initialA, initialB }: Props) {
  const [a, setA] = useState(initialA || runs[0]?.id || "");
  const [b, setB] = useState(initialB || runs[1]?.id || "");
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [summaryA, setSummaryA] = useState<any>(null);
  const [summaryB, setSummaryB] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "regressions" | "improvements">("all");

  useEffect(() => { setA(initialA || runs[0]?.id || ""); setB(initialB || runs[1]?.id || ""); }, [initialA, initialB, runs]);

  useEffect(() => {
    if (!a || !b || a === b) { setRows([]); return; }
    setLoading(true);
    Promise.all([
      fetch(`/api/runs/${a}?lite=1`).then((r) => r.json()),
      fetch(`/api/runs/${b}?lite=1`).then((r) => r.json()),
    ]).then(([da, db]: [any, any]) => {
      setSummaryA(da.run?.summary);
      setSummaryB(db.run?.summary);
      const mapA = new Map<string, any>((da.cases || []).map((c: any) => [c.case_id, c]));
      const mapB = new Map<string, any>((db.cases || []).map((c: any) => [c.case_id, c]));
      const ids = new Set<string>([...mapA.keys(), ...mapB.keys()]);
      const out: CaseRow[] = [];
      for (const id of ids) {
        const ca = mapA.get(id); const cb = mapB.get(id);
        const rate = (c: any) => c?.runner_result ? c.runner_result.usage.outputTokens / Math.max(c.runner_result.durationMs / 1000, 0.001) : 0;
        out.push({
          caseId: id,
          caseName: (cb || ca)?.case_name || id,
          category: (cb || ca)?.category || "",
          difficulty: (cb || ca)?.difficulty,
          aStatus: ca?.status ?? null,
          bStatus: cb?.status ?? null,
          aTokPerSec: rate(ca), bTokPerSec: rate(cb),
          aCost: ca?.runner_result?.usage.costUsd ?? 0,
          bCost: cb?.runner_result?.usage.costUsd ?? 0,
          aTurns: ca?.runner_result?.numTurns ?? 0,
          bTurns: cb?.runner_result?.numTurns ?? 0,
          aModel: ca?.runner_result?.model, bModel: cb?.runner_result?.model,
        });
      }
      out.sort((x, y) => cmp(x.caseName, y.caseName));
      setRows(out);
    }).finally(() => setLoading(false));
  }, [a, b]);

  const regressions = rows.filter((r) => r.aStatus === "passed" && r.bStatus && r.bStatus !== "passed");
  const improvements = rows.filter((r) => r.aStatus && r.aStatus !== "passed" && r.bStatus === "passed");

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader icon={GitCompareArrows} title="Compare runs" subtitle="Diff two runs to surface per-case regressions and model deltas." />

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <RunSelect label="Baseline A" value={a} onChange={setA} runs={runs} />
          <ArrowRight className="size-4 text-fg-dim mb-3 hidden md:block" />
          <RunSelect label="Comparison B" value={b} onChange={setB} runs={runs} />
        </div>
      </div>

      {a && b && a !== b && summaryA && summaryB && (
        <section className="stagger-grid grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Delta label="Pass rate" a={`${(summaryA.passRate * 100).toFixed(0)}%`} b={`${(summaryB.passRate * 100).toFixed(0)}%`} higherIsBetter aVal={summaryA.passRate} bVal={summaryB.passRate} />
          <Delta label="pass@1" a={fmtPct(summaryA.passAt1)} b={fmtPct(summaryB.passAt1)} aVal={summaryA.passAt1} bVal={summaryB.passAt1} higherIsBetter hint={`95% CI ${fmtCi(summaryA.passAt1Ci95)} → ${fmtCi(summaryB.passAt1Ci95)}`} />
          <Delta label="pass@k" a={fmtPct(summaryA.passAtK)} b={fmtPct(summaryB.passAtK)} aVal={summaryA.passAtK} bVal={summaryB.passAtK} />
          <Delta label="pass^k (reliability)" a={fmtPct(summaryA.passPowK)} b={fmtPct(summaryB.passPowK)} aVal={summaryA.passPowK} bVal={summaryB.passPowK} />
          <Delta label="Total cost" a={`$${summaryA.totalCostUsd.toFixed(4)}`} b={`$${summaryB.totalCostUsd.toFixed(4)}`} aVal={summaryA.totalCostUsd} bVal={summaryB.totalCostUsd} lowerIsBetter />
          <Delta label="Avg tok/s" a={(summaryA.totalTokensOut / Math.max(summaryA.totalDurationMs / 1000, 0.001)).toFixed(1)} b={(summaryB.totalTokensOut / Math.max(summaryB.totalDurationMs / 1000, 0.001)).toFixed(1)} aVal={summaryA.totalTokensOut / Math.max(summaryA.totalDurationMs, 1)} bVal={summaryB.totalTokensOut / Math.max(summaryB.totalDurationMs, 1)} />
          <Delta label="Tokens in" a={summaryA.totalTokensIn.toLocaleString()} b={summaryB.totalTokensIn.toLocaleString()} aVal={summaryA.totalTokensIn} bVal={summaryB.totalTokensIn} lowerIsBetter />
          <Delta label="Errors" a={String(summaryA.errored)} b={String(summaryB.errored)} aVal={summaryA.errored} bVal={summaryB.errored} lowerIsBetter />
        </section>
      )}

      {loading && <div className="text-sm text-fg-muted mb-4 flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Loading diff…</div>}

      {runs.length < 2 && (
        <section className="card p-10 text-center">
          <div className="text-sm text-fg-muted">Create at least two runs to compare regressions and performance deltas.</div>
          <Link href="/runs/new" className="mt-3 inline-flex text-xs text-accent-soft hover:underline">Start another run</Link>
        </section>
      )}

      {a && b && a === b && (
        <section className="card p-6 text-center text-sm text-fg-muted">
          Pick two different runs to compute a useful diff.
        </section>
      )}

      {a && b && a !== b && rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 mb-3 text-xs items-center">
            <div className="flex gap-1">
              <button onClick={() => setViewMode("all")} className={clsx("px-2.5 py-1 rounded-md border transition-colors", viewMode === "all" ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev")}>All</button>
              <button onClick={() => setViewMode("regressions")} className={clsx("px-2.5 py-1 rounded-md border transition-colors", viewMode === "regressions" ? "border-err bg-err/10 text-err" : "border-bd text-fg-muted hover:bg-bg-elev")}>▼ {regressions.length} regression{regressions.length !== 1 ? "s" : ""}</button>
              <button onClick={() => setViewMode("improvements")} className={clsx("px-2.5 py-1 rounded-md border transition-colors", viewMode === "improvements" ? "border-ok bg-ok/10 text-ok" : "border-bd text-fg-muted hover:bg-bg-elev")}>▲ {improvements.length} improvement{improvements.length !== 1 ? "s" : ""}</button>
            </div>
          </div>
          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Case</th>
                    <th className="text-left px-4 py-2 font-medium">A</th>
                    <th className="text-left px-4 py-2 font-medium">B</th>
                    <th className="text-right px-4 py-2 font-medium">tok/s Δ</th>
                    <th className="text-right px-4 py-2 font-medium">cost Δ</th>
                    <th className="text-right px-4 py-2 font-medium">turns Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {(viewMode === "regressions" ? regressions : viewMode === "improvements" ? improvements : rows).map((r) => {
                    const regressed = r.aStatus === "passed" && r.bStatus && r.bStatus !== "passed";
                    const improved = r.aStatus && r.aStatus !== "passed" && r.bStatus === "passed";
                    return (
                      <tr key={r.caseId} className={clsx(regressed && "bg-err/5", improved && "bg-ok/5", "hover:bg-bg-elev")}>
                        <td className="px-4 py-2 pl-3 relative">
                          {(regressed || improved) && (
                            <div className={clsx("absolute left-0 top-0 bottom-0 w-0.5", regressed ? "bg-err" : "bg-ok")} />
                          )}
                          <Link href={`/runs/${b}/case/${r.caseId}`} className="hover:text-accent-soft">{r.caseName}</Link>
                          <div className="text-[10px] text-fg-dim mono">{r.caseId} · {r.category}{r.difficulty ? ` · ${r.difficulty}` : ""}</div>
                        </td>
                        <td className="px-4 py-2"><StatusPill status={r.aStatus} /></td>
                        <td className="px-4 py-2"><StatusPill status={r.bStatus} /></td>
                        <td className="px-4 py-2 text-right mono"><DeltaText value={r.bTokPerSec - r.aTokPerSec} digits={1} higherIsBetter /></td>
                        <td className="px-4 py-2 text-right mono"><DeltaText value={r.bCost - r.aCost} digits={4} prefix="$" lowerIsBetter /></td>
                        <td className="px-4 py-2 text-right mono"><DeltaText value={r.bTurns - r.aTurns} digits={0} lowerIsBetter /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function RunSelect({ label, value, onChange, runs }: { label: string; value: string; onChange: (v: string) => void; runs: RunLite[] }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono">
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

function Delta({ label, a, b, aVal, bVal, higherIsBetter, lowerIsBetter, hint }: { label: string; a: string; b: string; aVal: number; bVal: number; higherIsBetter?: boolean; lowerIsBetter?: boolean; hint?: string }) {
  const diff = bVal - aVal;
  let tone = "text-fg-muted";
  let bgTone = "";
  let arrow = "";
  if (higherIsBetter) {
    tone = diff > 0 ? "text-ok" : diff < 0 ? "text-err" : "text-fg-muted";
    bgTone = diff > 0 ? "bg-ok/5" : diff < 0 ? "bg-err/5" : "";
    arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "";
  }
  if (lowerIsBetter) {
    tone = diff < 0 ? "text-ok" : diff > 0 ? "text-err" : "text-fg-muted";
    bgTone = diff < 0 ? "bg-ok/5" : diff > 0 ? "bg-err/5" : "";
    arrow = diff < 0 ? "▼" : diff > 0 ? "▲" : "";
  }
  return (
    <div className={clsx("card p-3", bgTone)}>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm mono text-fg-muted tabular-nums">{a}</span>
        <span className="text-fg-dim">→</span>
        <span className="text-sm mono font-medium tabular-nums">{b}</span>
      </div>
      <div className={clsx("text-[11px] mono mt-0.5 tabular-nums", tone)}>{arrow} {diff > 0 ? "+" : ""}{diff.toFixed(2)}</div>
      {hint && <div className="text-[10px] mono text-fg-dim mt-0.5 tabular-nums">{hint}</div>}
    </div>
  );
}

function fmtCi(ci?: { lo: number; hi: number }): string {
  return ci ? `${(ci.lo * 100).toFixed(0)}–${(ci.hi * 100).toFixed(0)}%` : "—";
}

function fmtPct(x?: number) { return x == null ? "—" : `${(x * 100).toFixed(0)}%`; }
function fmtDelta(x: number, digits = 2) { return `${x > 0 ? "+" : ""}${x.toFixed(digits)}`; }
function cmp(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
