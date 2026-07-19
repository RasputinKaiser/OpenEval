import { NextResponse } from "next/server";
import { scanAllSources } from "@/lib/collection/aggregate";
import { discoverAll } from "@/lib/collection/discover";

export const dynamic = "force-dynamic";

/**
 * Machine-wide transcript collection across every known harness.
 *   /api/collection            → full aggregate (discovery + parsed sessions)
 *   /api/collection?mode=discover → cheap discovery report (no session parsing)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");
  const parsedLimit = Number(searchParams.get("limit") || 200);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(10_000, parsedLimit)) : 200;

  if (mode === "discover") {
    const report = discoverAll();
    return NextResponse.json(
      { ...report, scannedAt: Date.now() },
      { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" } },
    );
  }

  // fresh = revalidate the corpus fingerprint NOW (skip the anti-stat-storm
  // window); it re-parses only if the fingerprint actually changed.
  const data = scanAllSources(limit, { fresh: true });
  return NextResponse.json(
    data,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
