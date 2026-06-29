import { NextResponse } from "next/server";
import { getRun, listRunCases } from "@/lib/db";
import { caseTelemetry, computeTelemetry } from "@/lib/summary";

export const dynamic = "force-dynamic";

interface TelemetryCacheEntry { caseSig: string; telemetry: any; perCase: any[]; at: number; }
const telemetryCache = new Map<string, TelemetryCacheEntry>();
const TELEMETRY_TTL = 10_000;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const cases = listRunCases(params.id);
  const caseSig = cases.map((c) => `${c.id}:${c.status}:${c.ended_at ?? 0}`).join("|");

  const cached = telemetryCache.get(params.id);
  if (cached && cached.caseSig === caseSig && Date.now() - cached.at < TELEMETRY_TTL) {
    return NextResponse.json({ telemetry: cached.telemetry, perCase: cached.perCase });
  }

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

  telemetryCache.set(params.id, { caseSig, telemetry, perCase, at: Date.now() });
  if (telemetryCache.size > 20) {
    const oldest = telemetryCache.keys().next().value;
    if (oldest) telemetryCache.delete(oldest);
  }

  return NextResponse.json({ telemetry, perCase });
}
