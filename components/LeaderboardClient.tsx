"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Loader2, Trophy, GitCompareArrows } from "lucide-react";
import HarnessBadge from "./HarnessBadge";

interface HarnessAggregate {
  harness: string;
  runCount: number;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  avgTokPerSec: number;
  model?: string;
  latestRunAt: number | null;
}

function fmtDur(ms: number) {
  if (!ms) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export default function LeaderboardClient() {
  const [rows, setRows] = useState<HarnessAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/harnesses/leaderboard")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRows(d.harnesses || []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const best = rows[0];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Trophy className="size-6" /> Harness Leaderboard</h1>
        <p className="text-sm text-fg-muted mt-1">Compare agent CLIs head-to-head: pass rate, cost, tokens, speed. The payoff for running the same suite across harnesses.</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Aggregating runs…</div>
      ) : rows.length === 0 ? (
        <section className="card p-10 text-center">
          <div className="text-sm text-fg-muted mb-2">No runs yet. Fan a suite across harnesses to populate the leaderboard:</div>
          <pre className="text-[11px] mono bg-bg border border-bd-subtle rounded-md p-3 inline-block text-left mt-2">{`npx tsx lib/cli/run.ts \\\n  --harness claude-code --harness codex \\\n  --parallel 4 --category agentic-swe`}</pre>
          <div className="mt-4"><Link href="/runs/new" className="text-xs text-accent-soft hover:underline">Start a run instead →</Link></div>
        </section>
      ) : (
        <>
          {best && (
            <section className="card p-4 mb-4 flex items-center gap-3">
              <Trophy className="size-5 text-yellow-500 shrink-0" />
              <div className="text-sm">
                <span className="text-fg-muted">Leading harness: </span>
                <HarnessBadge harness={best.harness} />
                <span className="ml-2 mono font-medium">{(best.passRate * 100).toFixed(0)}%</span>
                <span className="text-fg-dim"> across {best.totalCases} case(s) in {best.runCount} run(s)</span>
              </div>
            </section>
          )}
          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Harness</th>
                    <th className="text-right px-4 py-2 font-medium">Runs</th>
                    <th className="text-right px-4 py-2 font-medium">Cases</th>
                    <th className="text-right px-4 py-2 font-medium">Pass rate</th>
                    <th className="text-right px-4 py-2 font-medium">Pass / Fail</th>
                    <th className="text-right px-4 py-2 font-medium">Cost</th>
                    <th className="text-right px-4 py-2 font-medium">Tokens (in/out)</th>
                    <th className="text-right px-4 py-2 font-medium">Avg tok/s</th>
                    <th className="text-right px-4 py-2 font-medium">Total time</th>
                    <th className="text-left px-4 py-2 font-medium">Model</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {rows.map((r, idx) => (
                    <tr key={r.harness} className={clsx("hover:bg-bg-elev", idx === 0 && "bg-ok/5")}>
                      <td className="px-4 py-2.5"><HarnessBadge harness={r.harness} /></td>
                      <td className="px-4 py-2.5 text-right mono">{r.runCount}</td>
                      <td className="px-4 py-2.5 text-right mono">{r.totalCases}</td>
                      <td className="px-4 py-2.5 text-right mono font-semibold">
                        <span className={r.passRate >= 0.8 ? "text-ok" : r.passRate >= 0.5 ? "text-fg-muted" : "text-err"}>
                          {(r.passRate * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right mono text-xs">
                        <span className="text-ok">{r.passed}</span> / <span className="text-err">{r.failed}</span>
                        {r.errored > 0 && <span className="text-fg-dim"> · {r.errored} err</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right mono">${r.totalCostUsd.toFixed(4)}</td>
                      <td className="px-4 py-2.5 text-right mono text-xs">{r.totalTokensIn.toLocaleString()} / {r.totalTokensOut.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right mono">{r.avgTokPerSec.toFixed(1)}</td>
                      <td className="px-4 py-2.5 text-right mono">{fmtDur(r.totalDurationMs)}</td>
                      <td className="px-4 py-2.5 text-[11px] text-fg-dim mono">{r.model || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="mt-4 flex items-center gap-3 text-xs">
            <Link href="/runs/compare" className="flex items-center gap-1.5 text-accent-soft hover:underline">
              <GitCompareArrows className="size-3.5" /> Diff two runs
            </Link>
            <span className="text-fg-dim">·</span>
            <Link href="/harnesses" className="text-accent-soft hover:underline">Inspect discovered harnesses</Link>
          </div>
        </>
      )}
    </div>
  );
}
