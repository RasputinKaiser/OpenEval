"use client";

import { useEffect, useState } from "react";
import type { RunCaseRecord } from "@/lib/types";
import { statusCounts } from "@/lib/run-chart-analysis";
import { ChartFrame } from "../charts/ChartFrame";
import { SelectableBars } from "../charts/SelectableBars";

export function RunStatusChart({ cases, onSelect }: { cases: RunCaseRecord[]; onSelect: (index: number) => void }) {
  const [filter, setFilter] = useState<string | null>(null);
  const counts = statusCounts(cases);
  useEffect(() => { const read = () => setFilter(new URLSearchParams(window.location.search).get("caseStatus")); read(); window.addEventListener("popstate", read); return () => window.removeEventListener("popstate", read); }, []);
  const choose = (status: string | null) => {
    setFilter(status); const url = new URL(window.location.href);
    if (status === null) url.searchParams.delete("caseStatus"); else url.searchParams.set("caseStatus", status);
    window.history.pushState(window.history.state, "", url);
  };
  const matching = cases.flatMap((item, index) => filter === null || item.status === filter ? [{ item, index }] : []);
  return <div className="mb-4"><ChartFrame title="Case status distribution" description="Counts include every case/sample in this run. Pending, running, and skipped samples remain separate from graded outcomes."
    table={{ headers: ["Status", "Case/sample count"], rows: counts.map((item) => ({ id: item.status, cells: [item.status, item.count] })) }}
    details={<SelectableBars rows={counts.map((item) => ({ id: item.status, label: item.status, value: item.count, tone: item.status === "passed" ? "ok" : item.status === "failed" || item.status === "error" ? "err" : "accent" }))} noun="cases" onExplore={choose} />}>
    <div className="flex h-3 overflow-hidden rounded bg-bg-elev" role="img" aria-label={counts.map((item) => `${item.status}: ${item.count}`).join(", ")}>{counts.map((item) => <span key={item.status} style={{ width: `${item.count / Math.max(1, cases.length) * 100}%`, background: `var(--color-${item.status === "passed" ? "ok" : item.status === "failed" || item.status === "error" ? "err" : "accent"})` }} />)}</div>
    <p className="mt-2 text-xs text-fg-muted">{counts.map((item) => `${item.count} ${item.status}`).join(" · ")}</p>
  </ChartFrame>
    {filter && <div className="analysis-chart mt-2"><div className="flex flex-wrap items-center gap-2 mb-2 text-xs"><span>{matching.length} {filter} case/sample pairs</span><button type="button" className="analysis-control" onClick={() => choose(null)}>Clear status selection</button></div><div className="analysis-table" role="region" tabIndex={0} aria-label="Cases matching selected status"><ul className="p-2 space-y-1">{matching.map(({item,index}) => <li key={item.id}><button type="button" className="analysis-control" onClick={() => onSelect(index)}>{item.case_name} · sample {(item.sample ?? 0) + 1}</button></li>)}</ul></div></div>}
  </div>;
}
