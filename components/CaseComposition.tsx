"use client";
import { useState } from "react";
import type { CaseDefinition } from "@/lib/types";
import { groupedCounts } from "@/lib/ui-analysis";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";

export function CaseComposition({ cases, executions }: { cases: CaseDefinition[]; executions?: number | null }) {
  const [dimension, setDimension] = useState<"category" | "difficulty" | "evidence">("category");
  const rows = dimension === "evidence" ? groupedCounts(cases.flatMap(item => item.benchmark?.evidence.length ? item.benchmark.evidence : ["Undeclared"]), String) : groupedCounts(cases, item => item[dimension] ?? "Unspecified");
  const oracleCount = cases.filter(item => item.oracle?.solve || item.oracle?.final_text).length;
  const budgetCount = cases.filter(item => typeof item.budget?.max_cost_usd === "number").length;
  return <details className="case-composition card p-4 mb-4"><summary className="min-h-11 cursor-pointer content-center rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Suite composition · {cases.length} case{cases.length === 1 ? "" : "s"}{executions !== undefined && <> · {executions ?? "Unknown"} planned case attempt{executions === 1 ? "" : "s"}</>}</summary>
    <div className="mt-3 analysis-reveal">
      <dl className="analysis-summary mb-3"><div><dt>Cases with a reference solution</dt><dd>{oracleCount}/{cases.length}</dd></div><div><dt>Cases with a configured budget</dt><dd>{budgetCount}/{cases.length}</dd></div><div><dt>Visual cases</dt><dd>{cases.filter(item => item.visual).length}/{cases.length}</dd></div></dl>
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Suite composition dimension">{(["category", "difficulty", "evidence"] as const).map(item => <button key={item} type="button" className="analysis-control capitalize" aria-pressed={dimension === item} onClick={() => setDimension(item)}>{item}</button>)}</div>
      <ChartFrame title={`Cases by ${dimension}`} description={dimension === "evidence" ? "A case can declare more than one evidence type, so these counts can exceed the number of cases. They describe planned checks, not evidence collected from a run." : "Breakdown of the current case selection. These are tasks to run, not evaluation results."} table={{ headers: [dimension, "Cases"], rows: rows.map(row => ({ id: row.label, cells: [row.label, row.count] })) }}><SelectableBars rows={rows.map(row => ({ id: row.label, label: row.label, value: row.count }))} /></ChartFrame>
    </div>
  </details>;
}
