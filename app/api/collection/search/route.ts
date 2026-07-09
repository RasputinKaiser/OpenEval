import { NextResponse } from "next/server";
import { searchSessions } from "@/lib/collection/search";

export const dynamic = "force-dynamic";

/** Full-text search across every parseable harness's indexed sessions. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const result = searchSessions(q, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json(result);
}
