import TimelineClient from "@/components/TimelineClient";
import type { TimelineReport } from "@/lib/insights/collect";
import { getTimelineSnapshot } from "@/lib/collection/snapshot-service";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  let data: TimelineReport & {
    generatedAtMs?: number;
    stale?: boolean;
    refreshing?: boolean;
    refreshError?: string;
  };
  let error: string | undefined;
  try {
    const snapshot = await getTimelineSnapshot();
    data = {
      ...snapshot.value,
      generatedAtMs: snapshot.generatedAtMs,
      stale: snapshot.stale,
      refreshing: snapshot.refreshing,
      ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
    };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    data = {
      totalSessions: 0, signalSessions: 0, judgedSessions: 0, heuristicSignalSessions: 0, noSignalSessions: 0,
      signalCoverage: 0, judgedCoverage: 0, dateStart: null, dateEnd: null,
      overall: { firstHalfOutcome: 0, secondHalfOutcome: 0, trend: 0 },
      markers: [], impacts: [], changePoints: [], outcomeSeries: [],
    };
  }
  return <TimelineClient data={data} error={error} />;
}
