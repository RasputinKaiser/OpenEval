import LiveClient from "@/components/LiveClient";
import { defaultLiveLimitForHarness, projectLiveAggregate, readLiveSessionDetail, resolveLiveSessionFile, scanLiveSessions, getErroringTurns, type LiveAggregateList, type LiveSessionDetailResult, type TranscriptResult } from "@/lib/live";

export const dynamic = "force-dynamic";

async function getSessionTranscript(filePath: string, harness?: string): Promise<TranscriptResult> {
  "use server";
  const resolved = resolveLiveSessionFile(filePath, harness);
  if (!resolved) return { turns: [], error: "Invalid session path" };
  try {
    return getErroringTurns(resolved.file, resolved.source.format);
  } catch (e) {
    return { turns: [], error: `Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function getSessionDetail(filePath: string, harness?: string): Promise<LiveSessionDetailResult> {
  "use server";
  try {
    const session = readLiveSessionDetail(filePath, harness);
    return session ? { session } : { error: "Session detail is unavailable (the source file may have been pruned)." };
  } catch (e) {
    return { error: `Failed to parse session detail: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export default async function LivePage(props: { searchParams?: Promise<{ harness?: string; limit?: string }> }) {
  const searchParams = await props.searchParams;
  let data: LiveAggregateList;
  let error: string | undefined;
  const harness = searchParams?.harness || undefined;
  const parsedLimit = Number(searchParams?.limit || defaultLiveLimitForHarness(harness));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(1000, parsedLimit)) : defaultLiveLimitForHarness(harness);

  try {
    data = projectLiveAggregate(scanLiveSessions(limit, harness));
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
        sessionsWithCostEvidence: 0,
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
      sessionsWithInferredDuration: 0,
      subagentSessions: 0,
      sessionsWithMeasuredModel: 0,
      sessionsWithMissingModel: 0,
      sessionsWithInferredModel: 0,
      sessionsWithMissingTokens: 0,
      sessionsWithInferredCost: 0,
      archivedSessions: 0,
      sessionsWithMalformedLines: 0,
      staleSessions: 0,
      avgDataQuality: 0,
      scanCoverage: {
        requestedLimit: limit,
        discoveredFiles: 0,
        scannedFiles: 0,
        parsedFiles: 0,
        droppedFiles: 0,
        unscannedFiles: 0,
        archivedSessionsAdded: 0,
        truncated: false,
        partial: true,
      },
      scanWarnings: [],
      parseWarningCounts: {
        sessionsWithWarnings: 0,
        missingEvidence: 0,
        inferredEvidence: 0,
        incompleteTrace: 0,
        malformedInput: 0,
        runtimeErrors: 0,
        mixedModels: 0,
        other: 0,
      },
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

  return <LiveClient initialData={data} error={error} getTranscript={getSessionTranscript} getSessionDetail={getSessionDetail} scannedAt={Date.now()} />;
}
