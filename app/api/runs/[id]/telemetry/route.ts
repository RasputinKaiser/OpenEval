import { NextResponse } from "next/server";
import { getRun, listRunCases } from "@/lib/db";
import { caseTelemetry, computeTelemetry } from "@/lib/summary";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const cases = listRunCases(params.id);
  const telemetry = computeTelemetry(cases);
  const perCase = cases.map((c) => {
    const r = c.runner_result;
    const t = caseTelemetry(c);
    return {
      caseId: c.case_id,
      caseName: c.case_name,
      category: c.category,
      status: c.status,
      tokPerSec: t.tokPerSec,
      inTokPerSec: t.inTokPerSec,
      toolCallCount: t.toolCallCount,
      errorCount: t.errorCount,
      cacheHitRate: t.cacheHitRate,
      tokensPerCase: t.tokensPerCase,
      costPerCase: t.costPerCase,
      msPerTurn: t.msPerTurn,
      msPerTool: t.msPerTool,
      durationMs: r?.durationMs ?? 0,
      model: r?.model ?? null,
      numTurns: r?.numTurns ?? 0,
      toolDurationCoverage: t.toolDurationCoverage,
      durationSource: t.durationSource,
      tokenSource: t.tokenSource,
      toolSource: t.toolSource,
      throughputMode: t.throughputMode,
      warnings: t.warnings,
    };
  });
  return NextResponse.json({ telemetry, perCase });
}
