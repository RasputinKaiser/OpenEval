import { NextResponse } from "next/server";
import { scanAllSources, type CollectionSessionItem } from "@/lib/collection/aggregate";
import { discoverAll } from "@/lib/collection/discover";

export const dynamic = "force-dynamic";

/** The snapshot's own session cap — cursor paging walks this whole window. */
const SNAPSHOT_LIMIT = 10_000;
const PAGE_DEFAULT = 160;
const PAGE_MAX = 500;

/** Decoded cursor: position (lastEventAt) + identity (path when present, else sessionId). */
interface CursorPayload {
  t: number;
  id: string;
  p?: string;
}

function encodeCursor(s: CollectionSessionItem): string {
  const payload: CursorPayload = { t: s.lastEventAt, id: s.sessionId };
  if (s.path) payload.p = s.path;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, id, p } = parsed as Record<string, unknown>;
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    if (typeof id !== "string" || id.length === 0) return null;
    if (p !== undefined && typeof p !== "string") return null;
    return p === undefined ? { t, id } : { t, id, p };
  } catch {
    return null;
  }
}

/**
 * Machine-wide transcript collection across every known harness.
 *   /api/collection                  → full aggregate (discovery + parsed sessions)
 *   /api/collection?mode=discover    → cheap discovery report (no session parsing)
 *   /api/collection?cursor=…&page=n  → next page of sessions only (no stats/rollups),
 *                                      so paging cost stays O(page) on the wire
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  if (mode === "discover") {
    const report = discoverAll();
    return NextResponse.json(
      { ...report, scannedAt: Date.now() },
      { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" } },
    );
  }

  const rawCursor = searchParams.get("cursor");
  if (rawCursor !== null) {
    const cursor = decodeCursor(rawCursor);
    if (!cursor) {
      return NextResponse.json({ error: "malformed cursor" }, { status: 400 });
    }
    const parsedPage = Number(searchParams.get("page") || PAGE_DEFAULT);
    const page = Number.isFinite(parsedPage) ? Math.max(1, Math.min(PAGE_MAX, Math.trunc(parsedPage))) : PAGE_DEFAULT;
    const data = scanAllSources(SNAPSHOT_LIMIT, { fresh: true });
    const key = cursor.p ?? cursor.id;
    const at = data.sessions.findIndex((s) => (s.path ?? s.sessionId) === key);
    // Vanished cursor (corpus changed between pages): resume at the first item
    // strictly older than the cursor's timestamp — the client dedupes overlap.
    const start = at >= 0 ? at + 1 : data.sessions.findIndex((s) => s.lastEventAt < cursor.t);
    const sessions = start < 0 ? [] : data.sessions.slice(start, start + page);
    const exhausted = sessions.length === 0 || start + sessions.length >= data.sessions.length;
    return NextResponse.json(
      {
        sessions,
        nextCursor: exhausted ? null : encodeCursor(sessions[sessions.length - 1]),
        totalParsedSessions: data.totalParsedSessions,
        generatedAtMs: data.generatedAtMs,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const parsedLimit = Number(searchParams.get("limit") || 200);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(SNAPSHOT_LIMIT, parsedLimit)) : 200;

  // fresh = revalidate the corpus fingerprint NOW (skip the anti-stat-storm
  // window); it re-parses only if the fingerprint actually changed. Fetch the
  // full snapshot window so the response can carry a continuation cursor.
  const full = scanAllSources(SNAPSHOT_LIMIT, { fresh: true });
  const sessions = full.sessions.slice(0, limit);
  return NextResponse.json(
    {
      ...full,
      sessions,
      nextCursor: sessions.length > 0 && sessions.length < full.sessions.length
        ? encodeCursor(sessions[sessions.length - 1])
        : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
