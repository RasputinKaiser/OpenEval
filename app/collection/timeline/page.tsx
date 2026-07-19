import TimelineClient from "@/components/TimelineClient";
import { collectAllSessions } from "@/lib/collection/aggregate";
import { buildTimeline, type TimelineReport } from "@/lib/insights/collect";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  let data: TimelineReport;
  let error: string | undefined;
  try {
    data = buildTimeline(collectAllSessions());
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    data = {
      totalSessions: 0, signalCoverage: 0, judgedCoverage: 0, dateStart: null, dateEnd: null,
      overall: { firstHalfOutcome: 0, secondHalfOutcome: 0, trend: 0 },
      markers: [], impacts: [], changePoints: [], outcomeSeries: [],
    };
  }
  return <TimelineClient data={data} error={error} />;
}
