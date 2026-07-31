import { NextResponse } from "next/server";
import { SEARCH_QUERY_MAX_CHARS, searchSessions } from "@/lib/collection/search";

export const dynamic = "force-dynamic";

/** Full-text search across every parseable harness's indexed sessions. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length > SEARCH_QUERY_MAX_CHARS) {
    return NextResponse.json({ error: `Search query is limited to ${SEARCH_QUERY_MAX_CHARS} characters.` }, {
      status: 400,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const result = searchSessions(q, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json(result);
}
