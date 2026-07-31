import { NextResponse } from "next/server";
import { collectionSessionIdentity, type CollectionSessionItem } from "@/lib/collection/aggregate";
import { discoverAll } from "@/lib/collection/discover";
import { getCollectionSnapshot } from "@/lib/collection/snapshot-service";

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
  /** Source-qualified identity prevents equal session ids across harnesses colliding. */
  s?: string;
  /** Snapshot generation prevents a continuation from walking a reordered corpus. */
  g?: number;
}

function encodeCursor(s: CollectionSessionItem, generation: number): string {
  const payload: CursorPayload = { t: s.lastEventAt, id: s.sessionId, s: s.sourceId, g: generation };
  if (s.path) payload.p = s.path;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, id, p, s, g } = parsed as Record<string, unknown>;
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    if (typeof id !== "string" || id.length === 0) return null;
    if (p !== undefined && typeof p !== "string") return null;
    if (s !== undefined && (typeof s !== "string" || s.length === 0)) return null;
    if (g !== undefined && (typeof g !== "number" || !Number.isFinite(g))) return null;
    return {
      t,
      id,
      ...(p === undefined ? {} : { p }),
      ...(s === undefined ? {} : { s }),
      ...(g === undefined ? {} : { g }),
    };
  } catch {
    return null;
  }
}

/** Return true when a session sorts strictly after a vanished cursor. */
function isAfterCursor(session: CollectionSessionItem, cursor: CursorPayload): boolean {
  if (session.lastEventAt < cursor.t) return true;
  if (session.lastEventAt > cursor.t) return false;
  // Current cursors carry the source-qualified identity used by the stable
  // collection sort. Equal timestamps must continue by that tie-breaker or a
  // vanished cursor would skip every row sharing its timestamp.
  if (cursor.s === undefined) return false;
  const itemIdentity = collectionSessionIdentity(session);
  const cursorIdentity = `${cursor.s}\u0000${cursor.p ?? cursor.id}`;
  return itemIdentity > cursorIdentity;
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
    // Cursor pages are deliberately NEVER budgeted: a partial snapshot
    // mid-walk would slide the session window under the cursor and corrupt
    // pagination. The snapshot service keeps the window atomic while a stale
    // refresh runs in the background.
    const snapshot = await getCollectionSnapshot();
    const data = snapshot.value.aggregate;
    if (cursor.g !== undefined && cursor.g !== snapshot.generatedAtMs) {
      return NextResponse.json(
        { error: "collection snapshot changed; restart pagination", generatedAtMs: snapshot.generatedAtMs },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const key = cursor.p ?? cursor.id;
    const at = data.sessions.findIndex((s) => cursor.s !== undefined
      ? collectionSessionIdentity(s) === `${cursor.s}\u0000${key}`
      : (s.path ?? s.sessionId) === key);
    // Vanished cursor (corpus changed between pages): resume at the first item
    // strictly older than the cursor's timestamp — the client dedupes overlap.
    const start = at >= 0 ? at + 1 : data.sessions.findIndex((s) => isAfterCursor(s, cursor));
    const sessions = start < 0 ? [] : data.sessions.slice(start, start + page);
    const exhausted = sessions.length === 0 || start + sessions.length >= data.sessions.length;
    return NextResponse.json(
      {
        sessions,
        nextCursor: exhausted ? null : encodeCursor(sessions[sessions.length - 1], snapshot.generatedAtMs),
        totalParsedSessions: data.totalParsedSessions,
        generatedAtMs: data.generatedAtMs,
        stale: snapshot.stale,
        refreshing: snapshot.refreshing,
        ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const parsedLimit = Number(searchParams.get("limit") || 200);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(SNAPSHOT_LIMIT, parsedLimit)) : 200;

  // Scan-budget escape hatch: ?budget_ms=N (or OPENEVAL_SCAN_BUDGET_MS) time-
  // boxes a cold/changed-corpus parse. A budget-cut response carries
  // `partial: true` + per-source `scanTruncated` — partial results are always
  // labeled, never silently truncated — and repeated calls resume from cache.
  const rawBudget = searchParams.get("budget_ms") ?? process.env.OPENEVAL_SCAN_BUDGET_MS ?? null;
  let budgetMs: number | undefined;
  if (rawBudget !== null && rawBudget !== "") {
    const n = Number(rawBudget);
    if (Number.isFinite(n) && n >= 0) budgetMs = Math.min(n, 600_000);
  }

  // A caller-supplied budget is an explicit bounded refresh and is awaited so
  // its partial flag is visible. Ordinary stale refreshes are asynchronous:
  // the last-good snapshot is returned immediately with metadata below.
  const snapshot = await getCollectionSnapshot({ budgetMs });
  const full = snapshot.value.aggregate;
  const sessions = full.sessions.slice(0, limit);
  return NextResponse.json(
    {
      ...full,
      generatedAtMs: snapshot.generatedAtMs,
      stale: snapshot.stale,
      refreshing: snapshot.refreshing,
      ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
      sessions,
      nextCursor: sessions.length > 0 && sessions.length < full.sessions.length
        ? encodeCursor(sessions[sessions.length - 1], snapshot.generatedAtMs)
        : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
