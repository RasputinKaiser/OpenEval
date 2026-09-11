"use client";

import React from "react";
import clsx from "clsx";
import { Cpu } from "lucide-react";
import type { LiveAggregateList } from "@/lib/live";
import { fmt, fmtUsd, formatAvailableMetric } from "./live-shared";
import { MetricGroup, TinyMetric } from "./LivePrimitives";
import { ActivityDayStrip } from "./ActivityDayStrip";
import { DailyVolumeChart } from "./DailyVolumeChart";

// The parent re-renders on every poll tick (updatedAt); this strip only
// depends on `data`, so memo lets the unchanged-reference case skip it.
export const LiveUsageStrip = React.memo(function LiveUsageStrip({ data }: { data: LiveAggregateList }) {
  const usage = data.usageSummary;
  const tokenMeasured = usage.sessionsWithMeasuredUsage;
  const hasTokenEvidence = tokenMeasured > 0;
  const hasCostEvidence = usage.sessionsWithCostEvidence > 0;
  const hasRateEvidence = hasTokenEvidence && (data.sessionsWithMeasuredDuration + data.sessionsWithInferredDuration > 0);
  const costEstimated = data.sessionsWithInferredCost > 0;
  const costMissing = Math.max(0, data.totalSessions - usage.sessionsWithMeasuredCost - data.sessionsWithInferredCost);
  const measuredTone = tokenMeasured === data.totalSessions && data.totalSessions > 0 ? "ok" : tokenMeasured > 0 ? "warn" : "warn";
  return (
    <section id="usage" className="scroll-mt-16 mb-6 card min-w-0 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-bd-subtle px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cpu className="size-4 text-fg-muted" /> Usage
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            Tokens and cost are shown only when the selected trace source reports them
            {data.scanCoverage?.truncated ? "; totals cover the parsed latest-session slice shown above" : ""}.
          </div>
        </div>
        <div className={clsx(
          "inline-flex w-fit items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
          measuredTone === "ok" ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
        )}>
          {tokenMeasured}/{data.totalSessions} usage measured
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricGroup label="Token volume">
          <TinyMetric label="Total tokens" value={formatAvailableMetric(usage.totalTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Input tokens" value={formatAvailableMetric(usage.totalInputTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Output tokens" value={formatAvailableMetric(usage.totalOutputTokens, tokenMeasured, fmt)} />
        </MetricGroup>
        <MetricGroup label="Cache">
          <TinyMetric label="Cache read" value={formatAvailableMetric(usage.totalCacheReadTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Cache create" value={formatAvailableMetric(usage.totalCacheCreateTokens, tokenMeasured, fmt)} />
          {/* Token coverage share bar (measured vs missing), mirroring the cost evidence bar. */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-fg-muted">Token coverage</span>
              <span className="mono text-xs font-semibold tabular-nums text-fg">{Math.round(usage.tokenCoverage * 100)}%</span>
            </div>
            <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`${Math.round(usage.tokenCoverage * 100)}% of sessions report measured token usage`}>
              <div className="h-full transition-[width] duration-500" style={{ width: `${Math.min(100, usage.tokenCoverage * 100)}%`, background: hasTokenEvidence ? "var(--color-ok)" : "var(--color-warn)" }} />
            </div>
          </div>
        </MetricGroup>
        <MetricGroup label="Cost & rate">
          <TinyMetric label={costEstimated ? "Est. cost" : "Cost"} value={formatAvailableMetric(usage.totalCostUsd, hasCostEvidence ? 1 : 0, (value) => `${costEstimated ? "~" : ""}${fmtUsd(value)}`)} />
          {/* Cost evidence composition: hard numbers + a share bar, replacing the sentence-in-a-value-slot. */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-fg-muted">Cost evidence</span>
              <span className="mono text-xs font-semibold tabular-nums text-fg">{Math.round(usage.costCoverage * 100)}%</span>
            </div>
            <div className="mt-1 flex h-[5px] overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`${usage.sessionsWithMeasuredCost} recorded, ${data.sessionsWithInferredCost} estimated, ${costMissing} missing cost`} title={`${usage.sessionsWithMeasuredCost} recorded · ${data.sessionsWithInferredCost} estimated · ${costMissing} missing`}>
              {data.totalSessions > 0 && <>
                <div className="h-full" style={{ width: `${Math.min(100, (usage.sessionsWithMeasuredCost / Math.max(1, data.totalSessions)) * 100)}%`, background: "var(--color-ok)" }} />
                <div className="h-full" style={{ width: `${Math.min(100, (data.sessionsWithInferredCost / Math.max(1, data.totalSessions)) * 100)}%`, background: "color-mix(in srgb, var(--color-accent) 55%, transparent)" }} />
                {/* remainder renders as the bg-elev track = missing */}
              </>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-fg-dim" role="img" aria-label={`${usage.sessionsWithMeasuredCost} recorded, ${data.sessionsWithInferredCost} estimated, ${costMissing} missing cost evidence`}>
              <span>{usage.sessionsWithMeasuredCost} recorded</span>
              <span>{data.sessionsWithInferredCost} estimated</span>
              <span>{costMissing} missing</span>
            </div>
          </div>
          <TinyMetric label="Output rate" value={formatAvailableMetric(usage.avgOutputTokPerSec, hasRateEvidence ? 1 : 0, (value) => `${value.toFixed(1)} tok/s`)} />
        </MetricGroup>
      </div>
      {/* Time dimension: when did these sessions actually run? (30-day strip) */}
      {data.sessions.length > 0 && (
        <div className="border-t border-bd-subtle px-4 py-3">
          <ActivityDayStrip startedAts={data.sessions.map((s) => s.startedAt)} />
        </div>
      )}
      {/* Volume dimension: how much work did those days carry? (stacked daily split) */}
      {data.sessions.length > 0 && (
        <div className="border-t border-bd-subtle px-4 py-3">
          <DailyVolumeChart sessions={data.sessions.map((s) => ({ startedAt: s.startedAt, inputTokens: s.inputTokens, outputTokens: s.outputTokens, cacheReadTokens: s.cacheReadTokens }))} />
        </div>
      )}
      {data.totalSessions > 0 && tokenMeasured === 0 && (
        <div className="border-t border-bd-subtle px-4 py-3 text-xs text-warn">
          This source currently has no measured token usage in the scanned sessions; values are marked missing instead of treated as zero.
        </div>
      )}
    </section>
  );
});
