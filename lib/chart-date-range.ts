/** Inclusive UTC calendar days through today, with an exclusive upper bound. */
export function recentDateRange(days: 7 | 30, now = Date.now()) {
  const today = new Date(now);
  const toMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
  return { fromMs: toMs - days * 86_400_000, toMs };
}
