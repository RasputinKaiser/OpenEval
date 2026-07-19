import { NextResponse } from "next/server";
import { collectAllSessions } from "@/lib/collection/aggregate";
import { buildTimeline } from "@/lib/insights/collect";

export const dynamic = "force-dynamic";

/** Longitudinal report: adoption markers + before/after impact + outcome trend. */
export async function GET() {
  const data = buildTimeline(collectAllSessions());
  return NextResponse.json(
    data,
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } },
  );
}
