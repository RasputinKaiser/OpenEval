"use client";

import React from "react";
import clsx from "clsx";
import { Cpu } from "lucide-react";
import type { LiveAggregate } from "@/lib/live";
import { fmt } from "./live-shared";
import { MetricGroup, TinyMetric } from "./LivePrimitives";

// The parent re-renders on every poll tick (updatedAt); this strip only
// depends on `data`, so memo lets the unchanged-reference case skip it.
export const LiveUsageStrip = React.memo(function LiveUsageStrip({ data }: { data: LiveAggregate }) {
  const usage = data.usageSummary;
  const tokenMeasured = usage.sessionsWithMeasuredUsage;
  const costPriced = usage.sessionsWithPricedUsage;
  const costEstimated = data.sessionsWithInferredCost > 0;
  const measuredTone = tokenMeasured === data.totalSessions && data.totalSessions > 0 ? "ok" : tokenMeasured > 0 ? "warn" : "warn";
  return (
    <section id="usage" className="scroll-mt-16 mb-6 card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-bd-subtle px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cpu className="size-4 text-fg-muted" /> Usage
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            Tokens and cost are shown only when the selected trace source reports them.
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
          <TinyMetric label="Total tok" value={usage.totalTokens ? fmt(usage.totalTokens) : "missing"} />
          <TinyMetric label="Input" value={usage.totalInputTokens ? fmt(usage.totalInputTokens) : "missing"} />
          <TinyMetric label="Output" value={usage.totalOutputTokens ? fmt(usage.totalOutputTokens) : "missing"} />
        </MetricGroup>
        <MetricGroup label="Cache">
          <TinyMetric label="Cache read" value={usage.totalCacheReadTokens ? fmt(usage.totalCacheReadTokens) : "missing"} />
          <TinyMetric label="Cache create" value={usage.totalCacheCreateTokens ? fmt(usage.totalCacheCreateTokens) : "missing"} />
          <TinyMetric label="Coverage" value={`${Math.round(usage.tokenCoverage * 100)}%`} />
        </MetricGroup>
        <MetricGroup label="Cost & rate">
          <TinyMetric label={costEstimated ? "Est. cost" : "Cost"} value={costPriced ? `${costEstimated ? "~" : ""}$${usage.totalCostUsd.toFixed(4)}` : "missing"} />
          <TinyMetric label="Out tok/s" value={usage.avgOutputTokPerSec ? usage.avgOutputTokPerSec.toFixed(1) : "missing"} />
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
