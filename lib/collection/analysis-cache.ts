import type { CollectedSession } from './aggregate';
import type { ChartSelection } from '../chart-analysis';
import { buildAnalysisReport, filterAnalysisSessions, type AnalysisReport, type AnalysisSnapshotMeta } from './analysis';

/** Snapshot values are immutable. Replacing their array or generation drops every page. */
export function createAnalysisReader() {
  let current: readonly CollectedSession[] | undefined;
  let generation: number | undefined;
  const pages = new Map<string, AnalysisReport>();
  return (population: readonly CollectedSession[], selection: ChartSelection, meta: AnalysisSnapshotMeta, page: { offset: number; limit: number }): AnalysisReport => {
    if (current !== population || generation !== meta.generatedAtMs) {
      current = population; generation = meta.generatedAtMs; pages.clear();
    }
    // Include freshness/error metadata: a cached success cannot hide refresh failure.
    const key = JSON.stringify([Object.entries(selection).sort(([a], [b]) => a.localeCompare(b)), meta, page.offset, page.limit]);
    const cached = pages.get(key);
    if (cached) { pages.delete(key); pages.set(key, cached); return cached; }
    const report = buildAnalysisReport(population, filterAnalysisSessions(population, selection), selection, meta, page);
    // At most eight pages, each <=1 MiB serialized. Large/unbounded callers bypass cache.
    if (page.limit <= 200 && Buffer.byteLength(JSON.stringify(report)) <= 1_048_576) {
      if (pages.size >= 8) pages.delete(pages.keys().next().value!);
      pages.set(key, report);
    }
    return report;
  };
}
export const readAnalysisReport = createAnalysisReader();
