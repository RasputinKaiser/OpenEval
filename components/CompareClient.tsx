"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, GitCompareArrows, Loader2 } from "lucide-react";

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

  useEffect(() => { setA(initialA || runs[0]?.id || ""); setB(initialB || runs[1]?.id || ""); }, [initialA, initialB, runs]);

  useEffect(() => {
    if (!a || !b || a === b) { setRows([]); return; }
    setLoading(true);
    Promise.all([
      fetch(`/api/runs/${a}`).then((r) => r.json()),
      fetch(`/api/runs/${b}`).then((r) => r.json()),
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
          bTurns: ca?.runner_result?.numTurns ?? 0,
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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><GitCompareArrows className="size-6" /> Compare runs</h1>
        <p className="text-sm text-fg-muted mt-1">Diff two runs to surface per-case regressions and model deltas.</p>
      </header>

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <RunSelect label="Baseline A" value={a} onChange={setA} runs={runs} />
          <ArrowRight className="size-4 text-fg-dim mb-3 hidden md:block" />
          <RunSelect label="Comparison B" value={b} onChange={setB} runs={runs} />
        </div>
      </div>

      {a && b && a !== b && summaryA && summaryB && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Delta label="Pass rate" a={`${(summaryA.passRate * 100).toFixed(0)}%`} b={`${(summaryB.passRate * 100).toFixed(0)}%`} higherIsBetter aVal={summaryA.passRate} bVal={summaryB.passRate} />
          <Delta label="pass@1" a={fmtPct(summaryA.passAt1)} b={fmtPct(summaryB.passAt1)} aVal={summaryA.passAt1} bVal={summaryB.passAt1} />
          <Delta label="pass@k" a={fmtPct(summaryA.passAtK)} b={fmtPct(summaryB.passAtK)} aVal={summaryA.passAtK} bVal={summaryB.passAtK} />
          <Delta label="pass^k (reliability)" a={fmtPct(summaryA.passPowK)} b={fmtPct(summaryB.passPowK)} aVal={summaryA.passPowK} bVal={summaryB.passPowK} />
          <Delta label="Total cost" a={`$${summaryA.totalCostUsd.toFixed(4)}`} b={`$${summaryB.totalCostUsd.toFixed(4)}`} aVal={summaryA.totalCostUsd} bVal={summaryB.totalCostUsd} lowerIsBetter />
          <Delta label="Avg tok/s" a={(summaryA.totalTokensOut / Math.max(summaryA.totalDurationMs / 1000, 0.001)).toFixed(1)} b={(summaryB.totalTokensOut / Math.max(summaryB.totalDurationMs / 1000, 0.001)).toFixed(1)} aVal={summaryA.totalTokensOut / Math.max(summaryA.totalDurationMs, 1)} bVal={summaryB.totalTokensOut / Math.max(summaryB.totalDurationMs, 1)} />
          <Delta label="Tokens in" a={summaryA.totalTokensIn.toLocaleString()} b={summaryB.totalTokensIn.toLocaleString()} aVal={summaryA.totalTokensIn} bVal={summaryB.totalTokensIn} lowerIsBetter />
          <Delta label="Errors" a={String(summaryA.errored)} b={String(summaryB.errored)} aVal={summaryA.errored} bVal={summaryB.errored} lowerIsBetter />
        </section>
      )}

      {loading && <div className="text-sm text-fg-muted mb-4 flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Loading diff…</div>}

      {a && b && a !== b && rows.length > 0 && (
        <>
          <div className="flex gap-3 mb-3 text-xs">
            <span className="text-err">▼ {regressions.length} regression(s)</span>
            <span className="text-ok">▲ {improvements.length} improvement(s)</span>
          </div>
          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle">
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
                  {rows.map((r) => {
                    const regressed = r.aStatus === "passed" && r.bStatus && r.bStatus !== "passed";
                    const improved = r.aStatus && r.aStatus !== "passed" && r.bStatus === "passed";
                    return (
                      <tr key={r.caseId} className={clsx(regressed && "bg-err/5", improved && "bg-ok/5", "hover:bg-bg-elev")}>
                        <td className="px-4 py-2">
                          <Link href={`/runs/${b}/case/${r.caseId}`} className="hover:text-accent-soft">{r.caseName}</Link>
                          <div className="text-[10px] text-fg-dim mono">{r.caseId} · {r.category}{r.difficulty ? ` · ${r.difficulty}` : ""}</div>
                        </td>
                        <td className="px-4 py-2"><StatusPill status={r.aStatus} /></td>
                        <td className="px-4 py-2"><StatusPill status={r.bStatus} /></td>
                        <td className="px-4 py-2 text-right mono">{fmtDelta(r.bTokPerSec - r.aTokPerSec, 1)}</td>
                        <td className="px-4 py-2 text-right mono">${(r.bCost - r.aCost).toFixed(4)}</td>
                        <td className="px-4 py-2 text-right mono">{r.bTurns - r.aTurns > 0 ? "+" : ""}{r.bTurns - r.aTurns}</td>
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
  const c = status === "passed" ? "text-ok" : status === "failed" || status === "error" ? "text-err" : "text-fg-muted";
  const sym = status === "passed" ? "" : status === "failed" || status === "error" ? "" : "•";
  return <span className={clsx("text-xs mono", c)}>{sym} {status}</span>;
}

function Delta({ label, a, b, aVal, bVal, higherIsBetter, lowerIsBetter }: { label: string; a: string; b: string; aVal: number; bVal: number; higherIsBetter?: boolean; lowerIsBetter?: boolean }) {
  const diff = bVal - aVal;
  let tone = "text-fg-muted";
  if (higherIsBetter) tone = diff > 0 ? "text-ok" : diff < 0 ? "text-err" : "text-fg-muted";
  if (lowerIsBetter) tone = diff < 0 ? "text-ok" : diff > 0 ? "text-err" : "text-fg-muted";
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm mono text-fg-muted">{a}</span>
        <span className="text-fg-dim">→</span>
        <span className="text-sm mono font-medium">{b}</span>
      </div>
      <div className={`text-[11px] mono mt-0.5 ${tone}`}>{diff > 0 ? "+" : ""}{diff.toFixed(2)}</div>
    </div>
  );
}

function fmtPct(x?: number) { return x == null ? "—" : `${(x * 100).toFixed(0)}%`; }
function fmtDelta(x: number, digits = 2) { return `${x > 0 ? "+" : ""}${x.toFixed(digits)}`; }
function cmp(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }