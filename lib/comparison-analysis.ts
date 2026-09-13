/** Comparison graphics consume the same case/sample matched rows as the evidence table. */
export interface ComparisonValues {
  caseId: string; sample: number; caseName: string;
  aStatus: string | null; bStatus: string | null;
  aCost: number | null; bCost: number | null;
  aCostSource?: string; bCostSource?: string;
  aTokPerSec: number | null; bTokPerSec: number | null;
  aTurns: number | null; bTurns: number | null;
}
export type ComparisonMetric = "cost" | "rate" | "turns";
export const comparisonKey = (row: Pick<ComparisonValues, "caseId" | "sample">) => JSON.stringify([row.caseId, row.sample]);
export const transitionKey = (row: Pick<ComparisonValues, "aStatus" | "bStatus">) => JSON.stringify([row.aStatus, row.bStatus]);
export function transitionCounts(rows: readonly ComparisonValues[]) {
  const cells = new Map<string, { id: string; from: string | null; to: string | null; count: number }>();
  for (const row of rows) {
    const id = transitionKey(row), cell = cells.get(id);
    if (cell) cell.count++;
    else cells.set(id, { id, from: row.aStatus, to: row.bStatus, count: 1 });
  }
  return [...cells.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
export function comparisonDelta(row: ComparisonValues, metric: ComparisonMetric): number | null {
  const [a, b] = metric === "cost" ? [row.aCost, row.bCost] : metric === "rate" ? [row.aTokPerSec, row.bTokPerSec] : [row.aTurns, row.bTurns];
  return a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) ? null : b - a;
}
