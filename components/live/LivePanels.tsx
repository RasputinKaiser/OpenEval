"use client";

import React from "react";
import clsx from "clsx";
import { BarChart3, FileText, GitBranch, GitFork, Wrench, Zap } from "lucide-react";
import { SectionHeader } from "../Section";
import { compactDisplayPath } from "@/lib/redaction";
import type { LiveAggregateList } from "@/lib/live";
import { fmt } from "./live-shared";
import { tagModel } from "@/lib/model-taxonomy";
import { OutcomeStrip } from "./OutcomeStrip";
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
export const ModelPanel = React.memo(function ModelPanel({ data }: { data: LiveAggregateList }) {
  return (
    <section className="card min-w-0 overflow-hidden">
      <div className="border-b border-bd-subtle px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="size-4 text-fg-muted" /> Model evidence
        </div>
        <div className="mt-1 text-xs text-fg-muted">
          Inferred rows use the harness descriptor&apos;s declared default model; unknown rows mean the trace did not report model metadata.
        </div>
      </div>
      <div className="chart-scroll-well overflow-x-auto pb-2">
        <table className="min-w-[560px] w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[10px] uppercase tracking-[0.12em] text-fg-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-left font-medium">Share</th>
              <th className="px-4 py-2 text-right font-medium">Sessions</th>
              <th className="px-4 py-2 text-right font-medium">Quality</th>
              <th className="px-4 py-2 text-right font-medium">Missing</th>
              <th className="px-4 py-2 text-right font-medium">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd-subtle">
            {(() => {
              const total = Math.max(1, data.totalSessions);
              return data.byModel.map((model) => {
                const sharePct = Math.round((model.sessions / total) * 100);
                const isUnknown = model.model === "unknown";
                return (
              <tr key={model.model} className={clsx("hover:bg-bg-elev", isUnknown && "opacity-70")}>
                <td className="px-4 py-2">
                  <span className={clsx("mono text-xs", isUnknown && "text-fg-dim italic")}>{model.model}</span>
                  {(() => {
                    const tag = tagModel(model.model);
                    return !isUnknown && !tag.providerUnknown ? (
                      <span
                        className="ml-2 rounded-sm border border-bd-subtle bg-bg-subtle px-1 py-px align-middle text-[9px] uppercase tracking-[0.08em] text-fg-dim"
                        title={`Provider: ${tag.provider} · family: ${tag.family}`}
                      >
                        {tag.provider}
                      </span>
                    ) : null;
                  })()}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-[5px] w-20 min-w-0 overflow-hidden rounded-full bg-bg-elev transition-[height] duration-150 hover:h-[7px]"
                      role="img"
                      aria-label={`${model.model}: ${model.sessions} of ${total} sessions (${sharePct}%)`}
                      title={`${model.sessions} of ${total} sessions (${sharePct}%)`}
                    >
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, (model.sessions / total) * 100)}%`, background: isUnknown ? "var(--color-fg-dim)" : "color-mix(in srgb, var(--color-accent) 55%, transparent)" }} />
                    </div>
                    <span className="mono shrink-0 text-[10px] tabular-nums text-fg-dim">{sharePct}%</span>
                  </div>
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
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    </section>
  );
});

export const TraceIntelligencePanels = React.memo(function TraceIntelligencePanels({ data, redact, users }: { data: LiveAggregateList; redact: boolean; users: ReadonlySet<string> }) {
  const queueTotal = data.queueTotals.enqueue + data.queueTotals.dequeue + data.queueTotals.remove + data.queueTotals.popAll;
  return (
    <section id="intelligence" className="scroll-mt-16 mb-4">
    <SectionHeader
      icon={GitFork}
      title="Trace intelligence"
      desc="Execution graph, tool reliability, operator queue, and file impact across the scanned sessions"
      right={`${fmt(data.totalToolCalls)} tool calls`}
    />
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <section className="card overflow-hidden">
        <PanelHeader icon={GitFork} title="Execution graph" subtitle="Root thread, sidechains, and agents." />
        <div className="grid grid-cols-3 gap-2 p-4">
          <TinyMetric label="Sidechain msgs" value={fmt(data.sidechainMessages)} />
          <TinyMetric label="Agent sessions" value={fmt(data.agentSessions)} />
          <TinyMetric label="Projects" value={fmt(data.totalProjects)} />
        </div>
        <div className="border-t border-bd-subtle px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-fg-muted">Top branches</div>
          <ListStack items={data.topBranches.map((branch) => ({
            key: branch.branch,
            label: branch.branch,
            value: `${branch.sessions} sessions`,
          }))} redact={redact} users={users} empty="No branch metadata in this source — git context isn't captured by this harness." />
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={Wrench} title="Tool reliability" subtitle="Tool mix and error concentration." />
        <div className="divide-y divide-bd-subtle">
          {(() => {
            const maxCalls = Math.max(1, ...data.byTool.slice(0, 6).map((t) => t.calls));
            return data.byTool.slice(0, 6).map((tool) => (
            <div key={tool.name} className="group/tool px-4 py-2 text-sm transition-colors duration-150 hover:bg-bg-elev/60">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <span className="truncate">{tool.name}</span>
                <span className="mono tabular-nums text-xs text-fg-muted">{tool.calls}</span>
                <span className={clsx("mono tabular-nums text-xs", tool.errors ? "text-err" : "text-fg-dim")}>{tool.errors} err</span>
              </div>
              <div
                className="mt-1 h-[3px] overflow-hidden rounded-full bg-bg-elev transition-[height] duration-150 group-hover/tool:h-[5px]"
                role="img"
                aria-label={`${tool.name}: ${tool.calls} calls, ${tool.errors} errors`}
                title={`${tool.calls} calls · ${tool.errors} error${tool.errors === 1 ? "" : "s"} (${maxCalls} = busiest tool)`}
              >
                {/* Call volume with the error share as a distinct err-colored tail. */}
                <div className="flex h-full">
                  <div
                    className="h-full rounded-l-full transition-[width,filter] duration-500 group-hover/tool:brightness-125"
                    style={{ width: `${Math.max(2, ((tool.calls - tool.errors) / maxCalls) * 100)}%`, background: `color-mix(in srgb, var(--color-accent) 55%, transparent)` }}
                  />
                  {tool.errors > 0 && (
                    <div
                      className="h-full rounded-r-full transition-[width] duration-500"
                      style={{ width: `${(tool.errors / maxCalls) * 100}%`, background: "var(--color-err)", opacity: 0.8 }}
                    />
                  )}
                </div>
              </div>
            </div>
            ));
          })()}
          {data.byTool.length === 0 && <div className="p-4 text-sm text-fg-muted">No tool calls found.</div>}
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={Zap} title="Operator queue" subtitle="Queued prompts and interruption flow." />
        <div className="p-4">
          <div className="grid grid-cols-4 gap-2">
            <TinyMetric label="Total" value={fmt(queueTotal)} />
            <TinyMetric label="Enqueued" value={fmt(data.queueTotals.enqueue)} />
            <TinyMetric label="Dequeued" value={fmt(data.queueTotals.dequeue)} />
            <TinyMetric label="Dropped" value={fmt(data.queueTotals.remove + data.queueTotals.popAll)} />
          </div>
          {queueTotal > 0 && (
            <div className="mt-2 flex h-[5px] overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`${fmt(data.queueTotals.enqueue)} enqueued, ${fmt(data.queueTotals.dequeue)} dequeued, ${fmt(data.queueTotals.remove + data.queueTotals.popAll)} dropped of ${fmt(queueTotal)} total`} title="Queue flow composition">
              <div className="h-full" style={{ width: `${(data.queueTotals.enqueue / queueTotal) * 100}%`, background: "var(--color-accent)" }} />
              <div className="h-full" style={{ width: `${(data.queueTotals.dequeue / queueTotal) * 100}%`, background: "var(--color-ok)" }} />
              {/* remainder = dropped, rendered as the track */}
            </div>
          )}
        </div>
        <div className="border-t border-bd-subtle px-4 py-3">
          <ListStack items={data.queueTotals.preview.map((preview, index) => ({
            key: `${index}-${preview}`,
            label: preview,
          }))} redact={redact} users={users} empty="No queued prompts recorded — queue events aren't captured by this harness." />
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
          {(() => {
            const maxFileSessions = Math.max(1, ...data.topFiles.slice(0, 6).map((f) => f.sessions));
            return (
              <div className="space-y-2">
                {data.topFiles.slice(0, 6).map((file) => (
                  <div key={file.file} className="group/file min-w-0 transition-colors duration-150 hover:bg-bg-elev/60 rounded">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-fg-muted">{compactDisplayPath(file.file, redact)}</span>
                      <span className="mono shrink-0 text-[10px] text-fg-dim">{file.sessions} sessions</span>
                    </div>
                    <div
                      className="mt-1 h-[3px] overflow-hidden rounded-full bg-bg-elev transition-[height] duration-150 group-hover/file:h-[5px]"
                      role="img"
                      aria-label={`${compactDisplayPath(file.file, redact)}: touched in ${file.sessions} sessions`}
                      title={`${file.sessions} session${file.sessions === 1 ? "" : "s"} · ${maxFileSessions} = most-touched`}
                    >
                      <div className="h-full rounded-full transition-[width,filter] duration-500 group-hover/file:brightness-125" style={{ width: `${Math.max(2, (file.sessions / maxFileSessions) * 100)}%`, background: "color-mix(in srgb, var(--color-accent) 45%, transparent)" }} />
                    </div>
                  </div>
                ))}
                {data.topFiles.length === 0 && <div className="text-sm text-fg-muted">No touched files in the scanned slice — file paths come from tool inputs, which this source does not record.</div>}
              </div>
            );
          })()}
        </div>
      </section>

      {/* Transcript-derived outcome heuristics over the parsed slice. */}
      <div className="mt-4 rounded-lg border border-bd-subtle bg-bg-subtle/30 p-4">
        <OutcomeStrip counts={data.outcomeCounts} total={data.totalSessions} />
      </div>
    </div>
    </section>
  );
});
