import CollectionClient from "@/components/CollectionClient";
import { scanAllSources, type AllSourcesResult } from "@/lib/collection/aggregate";
import { buildRollup, type RollupReport } from "@/lib/collection/rollup";

export const dynamic = "force-dynamic";

export default async function CollectionPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const q = (await searchParams)?.q?.trim() || undefined;
  let data: AllSourcesResult;
  let error: string | undefined;
  try {
    data = scanAllSources(80);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    data = {
      generatedAtMs: Date.now(),
      sources: [], unknown: [], sessions: [], presentSources: 0, totalFiles: 0,
      totalParsedSessions: 0, totalArchivedSessions: 0, totalCostUsd: 0, anyEstimatedCost: false, totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheReadTokens: 0, totalCacheCreateTokens: 0, totalToolCalls: 0,
      totalPricedSessions: 0, totalMeasuredCostSessions: 0, totalListedRateSessions: 0,
      totalFamilyRateSessions: 0, totalFallbackRateSessions: 0,
      pricingListDate: "", pricingSource: "", byModel: [], byTool: [],
    };
  }
  let rollup: RollupReport | undefined;
  try { rollup = buildRollup(); } catch {}
  return <CollectionClient initialData={data} error={error} initialQuery={q} rollup={rollup} />;
}
