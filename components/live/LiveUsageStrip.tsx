"use client";

import React from "react";
import clsx from "clsx";
import { Cpu } from "lucide-react";
import type { LiveAggregateList } from "@/lib/live";
import { fmt, fmtUsd, formatAvailableMetric } from "./live-shared";
import { MetricGroup, TinyMetric } from "./LivePrimitives";

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
          "inline-flex w-fit items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
          measuredTone === "ok" ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
        )}>
          {tokenMeasured}/{data.totalSessions} usage measured
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricGroup label="Volume">
          <TinyMetric label="Total tok" value={formatAvailableMetric(usage.totalTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Input" value={formatAvailableMetric(usage.totalInputTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Output" value={formatAvailableMetric(usage.totalOutputTokens, tokenMeasured, fmt)} />
        </MetricGroup>
        <MetricGroup label="Cache">
          <TinyMetric label="Cache read" value={formatAvailableMetric(usage.totalCacheReadTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Cache create" value={formatAvailableMetric(usage.totalCacheCreateTokens, tokenMeasured, fmt)} />
          <TinyMetric label="Coverage" value={`${Math.round(usage.tokenCoverage * 100)}%`} />
        </MetricGroup>
        <MetricGroup label="Cost & rate">
          <TinyMetric label={costEstimated ? "Est. cost" : "Cost"} value={formatAvailableMetric(usage.totalCostUsd, hasCostEvidence ? 1 : 0, (value) => `${costEstimated ? "~" : ""}${fmtUsd(value)}`)} />
          <TinyMetric label="Cost evidence" value={`${usage.sessionsWithMeasuredCost} recorded · ${data.sessionsWithInferredCost} estimated · ${costMissing} missing`} />
          <TinyMetric label="Cost coverage" value={`${Math.round(usage.costCoverage * 100)}%`} />
          <TinyMetric label="Out tok/s" value={formatAvailableMetric(usage.avgOutputTokPerSec, hasRateEvidence ? 1 : 0, (value) => value.toFixed(1))} />
        </MetricGroup>
      </div>
      {data.totalSessions > 0 && tokenMeasured === 0 && (
        <div className="border-t border-bd-subtle px-4 py-3 text-xs text-warn">
          This source currently has no measured token usage in the scanned sessions; values are marked missing instead of treated as zero.
        </div>
      )}
    </section>
  );
});
