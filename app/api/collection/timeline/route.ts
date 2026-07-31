import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { getTimelineSnapshot } from "@/lib/collection/snapshot-service";

export const dynamic = "force-dynamic";

/** Longitudinal report: adoption markers + before/after impact + outcome trend. */
export async function GET(request: Request) {
  const forceRefresh = new URL(request.url).searchParams.get("fresh") === "1";
  const cacheControl = forceRefresh
    ? "private, no-store, max-age=0"
    : "private, max-age=30, stale-while-revalidate=120";
  try {
    const snapshot = await getTimelineSnapshot({ forceRefresh });
    return NextResponse.json(
      {
        ...snapshot.value,
        generatedAtMs: snapshot.generatedAtMs,
        stale: snapshot.stale,
        refreshing: snapshot.refreshing,
        ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
      },
      { headers: { "Cache-Control": cacheControl } },
    );
  } catch (error) {
    return apiError(500, "Timeline snapshot unavailable", {
      detail: error instanceof Error ? error.message : String(error),
      headers: { "Cache-Control": cacheControl },
    });
  }
}
