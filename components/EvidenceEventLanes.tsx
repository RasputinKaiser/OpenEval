"use client";
import { useState } from "react";
import type { EvidenceRecord } from "@/lib/insights/evidence";
import { ChartFrame } from "./charts/ChartFrame";

const LANES = [
  { id: "request", label: "User intent", kinds: ["request", "constraint", "feedback"], color: "accent-soft" },
  { id: "execution", label: "Tool work", kinds: ["tool_call", "tool_result"], color: "ok" },
  { id: "error", label: "Errors", kinds: ["error", "diagnostic"], color: "warn" },
  { id: "assistant", label: "Assistant", kinds: ["assistant_output"], color: "accent" },
  { id: "final", label: "Final receipts", kinds: ["final_output"], color: "fg-muted" },
];
export function EvidenceEventLanes({ records, onSelect }: { records: EvidenceRecord[]; onSelect: (ids: string[] | null) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const min = records[0]?.sequence ?? 0, max = records.at(-1)?.sequence ?? min;
  const bins = Math.min(16, max - min + 1), step = (max - min + 1) / bins;
  const lanes = LANES.map(lane => ({ ...lane, groups: Array.from({ length: bins }, (_, index) => ({ id: `${lane.id}:${index}`, records: records.filter(record => lane.kinds.includes(record.kind) && Math.min(bins - 1, Math.floor((record.sequence - min) / step)) === index) })) }));
  const active = lanes.flatMap(lane => lane.groups).find(group => group.id === selected);
  return <ChartFrame title="Evidence sequence" description="Transcript order, not elapsed time. Gaps and omitted records retain their position; assistant output remains a claim channel." unit="Select a segment to filter the excerpts below" table={{ headers: ["Channel", "Retained records"], rows: lanes.map(lane => ({ id: lane.id, cells: [lane.label, lane.groups.reduce((sum, group) => sum + group.records.length, 0)] })) }}>
    <div className="space-y-1">{lanes.map(lane => <div key={lane.id} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2"><span className="text-[11px] text-fg-muted">{lane.label}</span><div className="flex gap-0.5">{lane.groups.map(group => <button key={group.id} type="button" disabled={!group.records.length} aria-label={`${lane.label}: ${group.records.length} records in segment ${Number(group.id.split(":")[1]) + 1}`} aria-pressed={selected === group.id} className="flex-1 min-w-0 min-h-9 flex items-center" onClick={() => { const next = selected === group.id ? null : group.id; setSelected(next); onSelect(next ? group.records.map(record => record.evidenceId) : null); }}><span className="w-full rounded-sm h-3" style={{ background: `var(--color-${lane.color})`, opacity: selected === group.id ? 1 : group.records.length ? .55 : .1 }} /></button>)}</div></div>)}</div>
    <div className="flex justify-between ml-[6.5rem] text-[10px] text-fg-dim mono mt-2"><span>Record {min + 1}</span><span>Record {max + 1}</span></div>
    {active && <div className="flex items-center gap-3 mt-3 text-xs" aria-live="polite"><span>{active.records.length} records selected</span><button type="button" className="analysis-control" onClick={() => { setSelected(null); onSelect(null); }}>Clear sequence selection</button></div>}
  </ChartFrame>;
}
