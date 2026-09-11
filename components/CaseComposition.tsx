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
  return <details className="card p-4 mb-4"><summary className="cursor-pointer text-sm font-medium">Suite composition · {cases.length} cases{executions !== undefined && <> · {executions ?? "Unknown"} planned executions</>}</summary>
    <div className="mt-3 analysis-reveal">
      <dl className="analysis-summary mb-3"><div><dt>Declared reference answer</dt><dd>{oracleCount}/{cases.length}</dd></div><div><dt>Cost ceiling declared</dt><dd>{budgetCount}/{cases.length}</dd></div><div><dt>Visual cases</dt><dd>{cases.filter(item => item.visual).length}/{cases.length}</dd></div></dl>
      <div className="flex gap-2 mb-3" role="group" aria-label="Suite composition dimension">{(["category", "difficulty", "evidence"] as const).map(item => <button key={item} type="button" className="analysis-control capitalize" aria-pressed={dimension === item} onClick={() => setDimension(item)}>{item}</button>)}</div>
      <ChartFrame title={`Cases by ${dimension}`} description={dimension === "evidence" ? "Declared evidence channels may overlap. These are author declarations, not measured coverage." : "Composition of the current case selection, before execution."} table={{ headers: [dimension, "Cases"], rows: rows.map(row => ({ id: row.label, cells: [row.label, row.count] })) }}><SelectableBars rows={rows.map(row => ({ id: row.label, label: row.label, value: row.count }))} /></ChartFrame>
    </div>
  </details>;
}
