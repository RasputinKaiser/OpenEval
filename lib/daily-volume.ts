export interface DailyVolumeSession { startedAt: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; }
export interface DailyVolumeBucket { start: number; input: number; output: number; cache: number; sessions: number; }
/** UTC day boundaries match the range passed from a day mark to the session list. */
export function buildDailyVolume(sessions: DailyVolumeSession[], days = 30, now = Date.now()) {
  const count = Math.max(1, Math.min(90, Math.floor(Number.isFinite(days) ? days : 30)));
  const end = Math.floor(now / 86_400_000) * 86_400_000;
  const buckets: DailyVolumeBucket[] = Array.from({ length: count }, (_, i) => ({ start: end - (count - i - 1) * 86_400_000, input: 0, output: 0, cache: 0, sessions: 0 }));
  let excluded = 0;
  for (const session of sessions) {
    const safe = (v: number) => Number.isFinite(v) && v >= 0 ? v : 0;
    const input = safe(session.inputTokens), output = safe(session.outputTokens), cache = safe(session.cacheReadTokens);
    if (input + output + cache === 0) continue;
    if (!Number.isFinite(session.startedAt) || session.startedAt <= 0) { excluded++; continue; }
    const i = Math.floor((session.startedAt - buckets[0].start) / 86_400_000);
    if (i < 0 || i >= count) continue;
    buckets[i].input += input; buckets[i].output += output; buckets[i].cache += cache; buckets[i].sessions++;
  }
  return { buckets, excluded };
}
