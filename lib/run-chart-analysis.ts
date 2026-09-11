export interface TimedCase { started_at: number | null; ended_at: number | null; }
export interface ExecutionSegment { index: number; start: number; end: number; durationMs: number; lane: number; left: number; width: number; }
/** Keep overlapping case/sample intervals in separate hit-test lanes. */
export function executionLanes(cases: readonly TimedCase[], liveNow: number | null) {
  const timed = cases.flatMap((item, index) => {
    const start = item.started_at, end = item.ended_at ?? liveNow;
    return start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end >= start ? [{ index, start, end }] : [];
  }).sort((a, b) => a.start - b.start || a.index - b.index);
  if (!timed.length) return { segments: [] as ExecutionSegment[], lanes: 0, elapsedMs: 0, omitted: cases.length };
  const start = timed[0].start, end = timed.reduce((max, item) => Math.max(max, item.end), start), span = Math.max(1, end - start);
  const laneEnds: number[] = [];
  const segments = timed.map((item) => {
    let lane = laneEnds.findIndex((lastEnd) => lastEnd <= item.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = Math.max(item.start + 1, item.end);
    const left = (item.start - start) / span * 100;
    return { ...item, lane, durationMs: item.end - item.start, left, width: Math.min(100 - left, Math.max(0.4, (item.end - item.start) / span * 100)) };
  });
  return { segments, lanes: laneEnds.length, elapsedMs: end - start, omitted: cases.length - timed.length };
}
export function statusCounts(rows: readonly { status: string }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts].map(([status, count]) => ({ status, count }));
}
