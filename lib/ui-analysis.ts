/** Numerical summaries over the declared input population; missing is never zero. */
export function numericSummary(values: readonly (number | null | undefined)[]) {
  const available = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const quantile = (p: number): number | null => {
    if (!available.length) return null;
    const at = (available.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
    return available[lo] + (available[hi] - available[lo]) * (at - lo);
  };
  return { count: available.length, missing: values.length - available.length, min: available[0] ?? null, median: quantile(.5), p90: quantile(.9), max: available.at(-1) ?? null };
}

export function numericBins(values: readonly (number | null | undefined)[], count = 8) {
  const summary = numericSummary(values);
  if (summary.min === null || summary.max === null) return [];
  if (summary.min === summary.max) return [{ min: summary.min, max: summary.max, count: summary.count, final: true }];
  const n = Math.max(1, Math.min(20, Math.floor(count))), step = (summary.max - summary.min) / n;
  const bins = Array.from({ length: n }, (_, i) => ({ min: summary.min! + i * step, max: i === n - 1 ? summary.max! : summary.min! + (i + 1) * step, count: 0, final: i === n - 1 }));
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    bins[Math.min(n - 1, Math.max(0, Math.floor((value - summary.min) / step)))].count++;
  }
  return bins;
}

export function groupedCounts<T>(items: readonly T[], key: (item: T) => string) {
  const groups = new Map<string, number>();
  for (const item of items) { const value = key(item); groups.set(value, (groups.get(value) ?? 0) + 1); }
  return [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
