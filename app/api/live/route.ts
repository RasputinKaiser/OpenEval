import { NextResponse } from "next/server";
import { defaultLiveLimitForHarness, scanLiveSessions } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const harness = searchParams.get("harness") || "ncode";
  const parsedLimit = Number(searchParams.get("limit") || defaultLiveLimitForHarness(harness));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(1000, parsedLimit)) : defaultLiveLimitForHarness(harness);
  const data = scanLiveSessions(limit, harness);
  return NextResponse.json(data);
}
