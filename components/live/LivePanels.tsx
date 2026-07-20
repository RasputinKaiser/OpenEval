"use client";

import React from "react";
import clsx from "clsx";
import { BarChart3, FileText, GitBranch, GitFork, Wrench, Zap } from "lucide-react";
import { SectionHeader } from "../Section";
import { compactDisplayPath } from "@/lib/redaction";
import type { LiveAggregate } from "@/lib/live";
import { fmt } from "./live-shared";
import { ListStack, QualityBadge, TinyMetric } from "./LivePrimitives";

function PanelHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="border-b border-bd-subtle px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-fg-muted" /> {title}
      </div>
      <div className="mt-1 text-xs text-fg-muted">{subtitle}</div>
    </div>
  );
}

// The parent re-renders on every poll tick (updatedAt); these panels only
// depend on `data`, so memo lets the unchanged-reference case skip them.
export const ModelPanel = React.memo(function ModelPanel({ data }: { data: LiveAggregate }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-bd-subtle px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="size-4 text-fg-muted" /> Model evidence
        </div>
        <div className="mt-1 text-xs text-fg-muted">
          Inferred rows use the harness descriptor&apos;s declared default model; unknown rows mean the trace did not report model metadata.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[10px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Sessions</th>
              <th className="px-4 py-2 text-right font-medium">Quality</th>
              <th className="px-4 py-2 text-right font-medium">Missing</th>
              <th className="px-4 py-2 text-right font-medium">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd-subtle">
            {data.byModel.map((model) => (
              <tr key={model.model} className="hover:bg-bg-elev">
                <td className="px-4 py-2">
                  <span className="mono text-xs">{model.model}</span>
                </td>
                <td className="px-4 py-2 text-right mono tabular-nums">{model.sessions}</td>
                <td className="px-4 py-2 text-right">
                  <QualityBadge value={model.avgDataQuality} />
                </td>
                <td className="px-4 py-2 text-right text-xs text-fg-muted">
                  {model.missingTokens + model.missingCost ? `${model.missingTokens} token / ${model.missingCost} cost` : "—"}
                </td>
                <td className={clsx("px-4 py-2 text-right mono tabular-nums", model.errors > 0 && "text-err")}>{model.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});

export const TraceIntelligencePanels = React.memo(function TraceIntelligencePanels({ data, redact, users }: { data: LiveAggregate; redact: boolean; users: ReadonlySet<string> }) {
  const queueTotal = data.queueTotals.enqueue + data.queueTotals.dequeue + data.queueTotals.remove + data.queueTotals.popAll;
  return (
    <section id="intelligence" className="scroll-mt-16 mb-4">
    <SectionHeader
      icon={GitFork}
      title="Trace intelligence"
      desc="Execution graph, tool reliability, operator queue, and file impact across the scanned sessions"
      right={`${fmt(data.totalToolCalls)} tool calls`}
    />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <section className="card overflow-hidden">
        <PanelHeader icon={GitFork} title="Execution graph" subtitle="Root thread, sidechains, and agents." />
        <div className="grid grid-cols-3 gap-2 p-4">
          <TinyMetric label="Sidechain msgs" value={fmt(data.sidechainMessages)} />
          <TinyMetric label="Agent sessions" value={fmt(data.agentSessions)} />
          <TinyMetric label="Projects" value={fmt(data.totalProjects)} />
        </div>
        <div className="border-t border-bd-subtle px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-fg-muted">Top branches</div>
          <ListStack items={data.topBranches.map((branch) => ({
            key: branch.branch,
            label: branch.branch,
            value: `${branch.sessions} sessions`,
          }))} redact={redact} users={users} empty="No branch metadata found." />
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={Wrench} title="Tool reliability" subtitle="Tool mix and error concentration." />
        <div className="divide-y divide-bd-subtle">
          {data.byTool.slice(0, 6).map((tool) => (
            <div key={tool.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-sm">
              <span className="truncate">{tool.name}</span>
              <span className="mono tabular-nums text-xs text-fg-muted">{tool.calls}</span>
              <span className={clsx("mono tabular-nums text-xs", tool.errors ? "text-err" : "text-fg-dim")}>{tool.errors} err</span>
            </div>
          ))}
          {data.byTool.length === 0 && <div className="p-4 text-sm text-fg-muted">No tool calls found.</div>}
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={Zap} title="Operator queue" subtitle="Queued prompts and interruption flow." />
        <div className="grid grid-cols-4 gap-2 p-4">
          <TinyMetric label="Total" value={fmt(queueTotal)} />
          <TinyMetric label="Enq" value={fmt(data.queueTotals.enqueue)} />
          <TinyMetric label="Deq" value={fmt(data.queueTotals.dequeue)} />
          <TinyMetric label="Drop" value={fmt(data.queueTotals.remove + data.queueTotals.popAll)} />
        </div>
        <div className="border-t border-bd-subtle px-4 py-3">
          <ListStack items={data.queueTotals.preview.map((preview, index) => ({
            key: `${index}-${preview}`,
            label: preview,
          }))} redact={redact} users={users} empty="No queued prompt previews." />
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={FileText} title="File / repo impact" subtitle="Touched files inferred from tools and snapshots." />
        <div className="border-b border-bd-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <GitBranch className="size-3.5" />
            {data.topBranches[0]?.branch ?? "branch missing"}
          </div>
        </div>
        <div className="px-4 py-3">
          <ListStack items={data.topFiles.slice(0, 6).map((file) => ({
            key: file.file,
            label: compactDisplayPath(file.file, redact),
            value: `${file.sessions} sessions`,
          }))} redact={false} users={users} empty="No touched files inferred." />
        </div>
      </section>
    </div>
    </section>
  );
});
