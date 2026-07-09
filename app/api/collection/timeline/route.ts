import { NextResponse } from "next/server";
import { buildTimeline } from "@/lib/insights/collect";

export const dynamic = "force-dynamic";

/** Longitudinal report: adoption markers + before/after impact + outcome trend. */
export async function GET() {
  const data = buildTimeline();
  return NextResponse.json(
    data,
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } },
  );
}
