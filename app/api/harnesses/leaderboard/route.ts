import { NextResponse } from "next/server";
import { listRuns, getRunCaseSummariesBatch } from "@/lib/db";
import { internalError } from "@/lib/api-http";

export const dynamic = "force-dynamic";

export interface HarnessAggregate {
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

function aggregateByHarness(): HarnessAggregate[] {
  const runs = listRuns(200);
  const runIds = runs.map((r) => r.id);
  const caseSummaries = getRunCaseSummariesBatch(runIds);
  const byHarness = new Map<string, HarnessAggregate>();

  for (const r of runs) {
    const h = r.params.harness || "unknown";
    const cases = caseSummaries.get(r.id) ?? [];
    const completed = cases.filter((c) => ["passed", "failed", "error"].includes(c.status));
    const passed = cases.filter((c) => c.status === "passed").length;
    const failed = cases.filter((c) => c.status === "failed").length;
    const errored = cases.filter((c) => c.status === "error").length;
    let cost = 0, tokIn = 0, tokOut = 0, dur = 0;
    for (const c of cases) {
      cost += c.runner_cost_usd ?? 0;
      tokIn += c.runner_input_tokens ?? 0;
      tokOut += c.runner_output_tokens ?? 0;
      dur += c.runner_duration_ms ?? 0;
    }
    const agg = byHarness.get(h) ?? {
      harness: h, runCount: 0, totalCases: 0, passed: 0, failed: 0, errored: 0, passRate: 0,
      totalCostUsd: 0, totalTokensIn: 0, totalTokensOut: 0, totalDurationMs: 0, avgTokPerSec: 0,
      latestRunAt: null,
    };
    agg.runCount += 1;
    agg.totalCases += completed.length;
    agg.passed += passed;
    agg.failed += failed;
    agg.errored += errored;
    agg.totalCostUsd += cost;
    agg.totalTokensIn += tokIn;
    agg.totalTokensOut += tokOut;
    agg.totalDurationMs += dur;
    agg.latestRunAt = Math.max(agg.latestRunAt ?? 0, r.created_at);
    if (!agg.model && r.params.model) agg.model = r.params.model;
    byHarness.set(h, agg);
  }

  const list = Array.from(byHarness.values()).map((a) => ({
    ...a,
    passRate: a.totalCases > 0 ? a.passed / a.totalCases : 0,
    avgTokPerSec: a.totalDurationMs > 0 ? a.totalTokensOut / (a.totalDurationMs / 1000) : 0,
  }));
  list.sort((a, b) => b.passRate - a.passRate || b.runCount - a.runCount);
  return list;
}

export async function GET() {
  try {
    return NextResponse.json(
      { harnesses: aggregateByHarness() },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } }
    );
  } catch (error) {
    return internalError("Failed to build harness leaderboard", error);
  }
}
