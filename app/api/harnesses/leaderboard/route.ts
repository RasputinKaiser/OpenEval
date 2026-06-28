import { NextResponse } from "next/server";
import { listRuns, listRunCases } from "@/lib/db";

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

export async function GET() {
  const runs = listRuns(200);
  const byHarness = new Map<string, HarnessAggregate>();

  for (const r of runs) {
    const h = r.params.harness || "ncode";
    const cases = listRunCases(r.id);
    const completed = cases.filter((c) => ["passed", "failed", "error"].includes(c.status));
    const passed = cases.filter((c) => c.status === "passed").length;
    const failed = cases.filter((c) => c.status === "failed").length;
    const errored = cases.filter((c) => c.status === "error").length;
    let cost = 0, tokIn = 0, tokOut = 0, dur = 0;
    for (const c of cases) {
      const u = c.runner_result?.usage;
      if (u) { cost += u.costUsd || 0; tokIn += u.inputTokens || 0; tokOut += u.outputTokens || 0; }
      if (c.runner_result?.durationMs) dur += c.runner_result.durationMs;
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

  return NextResponse.json({ harnesses: list });
}
