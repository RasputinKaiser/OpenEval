import path from "node:path";
import LiveClient from "@/components/LiveClient";
import { defaultLiveLimitForHarness, scanLiveSessions, isPathInLiveSource, liveTraceFormatForHarness, getErroringTurns, type LiveAggregate, type TranscriptResult } from "@/lib/live";

export const dynamic = "force-dynamic";

async function getSessionTranscript(filePath: string, harness?: string): Promise<TranscriptResult> {
  "use server";
  const normalized = path.resolve(filePath);
  const format = liveTraceFormatForHarness(harness);
  const supportedExtension = normalized.endsWith(".jsonl") || (format === "hermes-json" && normalized.endsWith(".json"));
  if (!supportedExtension || !isPathInLiveSource(normalized, harness)) {
    return { turns: [], error: "Invalid session path" };
  }
  try {
    return getErroringTurns(normalized, format);
  } catch (e) {
    return { turns: [], error: `Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export default async function LivePage(props: { searchParams?: Promise<{ harness?: string; limit?: string }> }) {
  const searchParams = await props.searchParams;
  let data: LiveAggregate;
  let error: string | undefined;
  const harness = searchParams?.harness || undefined;
  const parsedLimit = Number(searchParams?.limit || defaultLiveLimitForHarness(harness));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(1000, parsedLimit)) : defaultLiveLimitForHarness(harness);

  try {
    data = scanLiveSessions(limit, harness);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    data = {
      sourceHarness: harness ?? "",
      sourceLabel: harness ?? "unknown",
      sourceStatus: "error",
      sourceRoots: [],
      sourceMessage: error,
      usageSummary: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreateTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        sessionsWithMeasuredUsage: 0,
        sessionsWithMeasuredCost: 0,
        sessionsWithPricedUsage: 0,
        sessionsWithListedRate: 0,
        sessionsWithFamilyRate: 0,
        sessionsWithFallbackRate: 0,
        tokenCoverage: 0,
        costCoverage: 0,
        avgOutputTokPerSec: 0,
      },
      totalSessions: 0,
      totalProjects: 0,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalToolCalls: 0,
      totalToolErrors: 0,
      sessionsWithMeasuredDuration: 0,
      sessionsWithMissingModel: 0,
      sessionsWithInferredModel: 0,
      sessionsWithMissingTokens: 0,
      sessionsWithInferredCost: 0,
      archivedSessions: 0,
      sessionsWithMalformedLines: 0,
      staleSessions: 0,
      avgDataQuality: 0,
      scanWarnings: [],
      byModel: [],
      byTool: [],
      queueTotals: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
      sidechainMessages: 0,
      agentSessions: 0,
      topBranches: [],
      topFiles: [],
      sessions: [],
    };
  }

  return <LiveClient initialData={data} error={error} getTranscript={getSessionTranscript} />;
}
