import CollectionClient from "@/components/CollectionClient";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import { getCollectionSnapshot } from "@/lib/collection/snapshot-service";
import type { RollupReport } from "@/lib/collection/rollup";

export const dynamic = "force-dynamic";
const INITIAL_COLLECTION_SESSION_LIMIT = 80;

export default async function CollectionPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const q = (await searchParams)?.q?.trim() || undefined;
  let data: AllSourcesResult;
  let error: string | undefined;
  let rollup: RollupReport | undefined;
  try {
    const snapshot = await getCollectionSnapshot();
    data = {
      ...snapshot.value.aggregate,
      // Keep the canonical snapshot complete for rollups and cursor paging,
      // but preserve the bounded page payload/render contract. Older sessions
      // remain available through the existing Load more cursor flow.
      sessions: snapshot.value.aggregate.sessions.slice(0, INITIAL_COLLECTION_SESSION_LIMIT),
      generatedAtMs: snapshot.generatedAtMs,
      stale: snapshot.stale,
      refreshing: snapshot.refreshing,
      ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
    };
    error = snapshot.refreshError;
    rollup = snapshot.value.rollup;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    data = {
      generatedAtMs: Date.now(),
      sources: [], unknown: [], sessions: [], presentSources: 0, totalFiles: 0,
      totalParsedSessions: 0, totalArchivedSessions: 0, totalCostUsd: 0, anyEstimatedCost: false, totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheReadTokens: 0, totalCacheCreateTokens: 0, totalToolCalls: 0,
      totalMeasuredUsageSessions: 0, totalMeasuredDurationSessions: 0,
      totalMissingModelSessions: 0, totalInferredModelSessions: 0,
      totalMissingTokenSessions: 0, totalInferredCostSessions: 0,
      totalMalformedLineSessions: 0, totalStaleSessions: 0,
      totalParseableFiles: 0, totalDetectOnlyFiles: 0,
      inventoryPartial: false, inventoryPartialSources: [],
      totalPricedSessions: 0, totalMeasuredCostSessions: 0, totalListedRateSessions: 0,
      totalFamilyRateSessions: 0, totalFallbackRateSessions: 0,
      pricingListDate: "", pricingSource: "", byModel: [], byTool: [], partial: false, partialSources: [],
    };
  }
  return <CollectionClient initialData={data} error={error} initialQuery={q} rollup={rollup} />;
}
