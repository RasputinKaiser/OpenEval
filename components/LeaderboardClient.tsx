"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, Loader2, Trophy, GitCompareArrows, ArrowUp, ArrowDown } from "lucide-react";
import HarnessBadge from "./HarnessBadge";
import PageHeader from "./PageHeader";
import { cachedFetch } from "@/lib/cached-fetch";
import { fmtDuration, fmtNum, fmtNumFull, fmtPct, fmtUsd, fmtUsdFull } from "@/lib/format";

/** Sticky harness column: row identity stays put while metrics scroll on narrow screens. */
const STICKY_TH = "sticky left-0 z-[2] bg-bg-subtle";
const STICKY_TD = "sticky left-0 z-[1] bg-bg-subtle";

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

export default function LeaderboardClient() {
  const [rows, setRows] = useState<HarnessAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof HarnessAggregate>("passRate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    cachedFetch<{ harnesses: HarnessAggregate[] }>("/api/harnesses/leaderboard")
      .then((d) => { if (!cancelled) { setRows(d.harnesses || []); setLoadError(null); } })
      // Never surface a failed fetch as a runtime overlay — show a retryable banner.
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [rows, sortKey, sortDir]);

  // "Leading harness" is the pass-rate leader regardless of the table's sort.
  const best = useMemo(
    () => (rows.length ? rows.reduce((acc, r) => (r.passRate > acc.passRate ? r : acc)) : undefined),
    [rows],
  );

  function toggleSort(key: keyof HarnessAggregate) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(typeof sortedRows[0]?.[key] === "string" ? "asc" : "desc");
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Trophy}
        title="Harness Leaderboard"
        subtitle="Compare agent CLIs head-to-head: pass rate, cost, tokens, speed. The payoff for running the same suite across harnesses."
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-err/40 bg-err/10 p-3 flex items-start gap-2.5" role="alert">
          <AlertTriangle className="size-4 text-err shrink-0 mt-0.5" />
          <div className="min-w-0 text-sm">
            <span className="font-medium text-err">Couldn&apos;t load the leaderboard</span>
            <span className="text-fg-muted"> — {loadError}. Reload the page to retry.</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Aggregating runs…</div>
      ) : loadError ? null : rows.length === 0 ? (
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
                {best.model && <span className="ml-1.5 text-[11px] mono text-fg-dim">{best.model}</span>}
                <span className="ml-2 mono font-medium tabular-nums">{fmtPct(best.passRate)}</span>
                <span className="text-fg-dim"> across {fmtNum(best.totalCases)} case{best.totalCases === 1 ? "" : "s"} in {fmtNum(best.runCount)} run{best.runCount === 1 ? "" : "s"}</span>
              </div>
            </section>
          )}
          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                  <tr>
                    <th className="text-center px-2 py-2 font-medium w-8">#</th>
                    <th className={clsx("text-left px-4 py-2 font-medium", STICKY_TH)}>
                      <SortBtn label="Harness" k="harness" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Runs" k="runCount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Cases" k="totalCases" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Pass rate" k="passRate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Passed" k="passed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Cost" k="totalCostUsd" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Tokens out" k="totalTokensOut" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Avg tok/s" k="avgTokPerSec" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Total time" k="totalDurationMs" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th className="text-left px-4 py-2 font-medium">
                      <SortBtn label="Model" k="model" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {sortedRows.map((r, idx) => (
                    <tr key={`${r.harness}::${r.model ?? ""}`} className={clsx("hover:bg-bg-elev", idx === 0 && sortKey === "passRate" && sortDir === "desc" && "bg-ok/5")}>
                      <td className="px-2 py-2.5 text-center">
                        <span className={clsx(
                          "inline-flex items-center justify-center size-5 rounded-full text-[10px] mono font-semibold tabular-nums",
                          idx === 0 ? "bg-yellow-500/15 text-yellow-400" :
                          idx === 1 ? "bg-gray-400/15 text-gray-300" :
                          idx === 2 ? "bg-amber-700/15 text-amber-600" :
                          "text-fg-dim"
                        )}>{idx + 1}</span>
                      </td>
                      <td className={clsx("px-4 py-2.5", STICKY_TD)}><HarnessBadge harness={r.harness} /></td>
                      <td className="px-4 py-2.5 text-right mono">{r.runCount}</td>
                      <td className="px-4 py-2.5 text-right mono">{r.totalCases}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-elev">
                            <div className="h-full flex">
                              <div className="bg-ok" style={{ width: `${r.passRate * 100}%` }} />
                              {r.failed > 0 && <div className="bg-err" style={{ width: `${(r.failed / r.totalCases) * 100}%` }} />}
                              {r.errored > 0 && <div className="bg-warn" style={{ width: `${(r.errored / r.totalCases) * 100}%` }} />}
                            </div>
                          </div>
                          <span className={clsx("mono font-semibold tabular-nums", r.passRate >= 0.8 ? "text-ok" : r.passRate >= 0.5 ? "text-fg-muted" : "text-err")}>
                            {fmtPct(r.passRate)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right mono text-xs">
                        <span className="text-ok">{r.passed}</span> / <span className="text-err">{r.failed}</span>
                        {r.errored > 0 && <span className="text-fg-dim"> · {r.errored} err</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right mono" title={fmtUsdFull(r.totalCostUsd)}>{fmtUsd(r.totalCostUsd)}</td>
                      <td className="px-4 py-2.5 text-right mono text-xs" title={`${fmtNumFull(r.totalTokensIn)} in / ${fmtNumFull(r.totalTokensOut)} out`}>{fmtNum(r.totalTokensIn)} / {fmtNum(r.totalTokensOut)}</td>
                      <td className="px-4 py-2.5 text-right mono">{r.avgTokPerSec.toFixed(1)}</td>
                      <td className="px-4 py-2.5 text-right mono">{fmtDuration(r.totalDurationMs)}</td>
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

function SortBtn({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = "right",
}: {
  label: string;
  k: keyof HarnessAggregate;
  sortKey: keyof HarnessAggregate;
  sortDir: "asc" | "desc";
  onClick: (k: keyof HarnessAggregate) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onClick(k)}
      className={clsx(
        "inline-flex items-center gap-1 hover:text-fg transition-colors",
        active && "text-accent-soft"
      )}
    >
      {align === "left" ? label : null}
      {active && (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />)}
      {align === "right" ? label : null}
    </button>
  );
}
