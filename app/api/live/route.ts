import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { defaultLiveLimitForHarness, projectLiveAggregate, scanLiveSessions, type LiveAggregate, type LiveAggregateList } from "@/lib/live";
import { clampInt, internalError, parseQuery, queryNumber } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" } as const;

type LiveScanner = (limit: number, harness?: string) => LiveAggregate;

const liveScanInFlight = new Map<string, Promise<LiveAggregate>>();

/**
 * Polling clients can reconnect or overlap requests during a slow scan. Share
 * only an identical in-flight scan; once it settles, the next request scans
 * again so this remains coalescing rather than an unannounced freshness cache.
 */
function coalescedLiveScan(limit: number, harness: string | undefined, scanner: LiveScanner = scanLiveSessions): Promise<LiveAggregate> {
  const key = JSON.stringify([harness ?? null, limit]);
  const existing = liveScanInFlight.get(key);
  if (existing) return existing;
  const task = Promise.resolve().then(() => scanner(limit, harness));
  liveScanInFlight.set(key, task);
  void task.then(
    () => { if (liveScanInFlight.get(key) === task) liveScanInFlight.delete(key); },
    () => { if (liveScanInFlight.get(key) === task) liveScanInFlight.delete(key); },
  );
  return task;
}

interface SerializedLiveProjection {
  json: string;
  sig: string;
}

// Hash the exact lean payload visible to the list. The projection excludes
// wall-clock-derived staleMs and drawer-only detail, so idle sources remain
// stable while every rendered aggregate/session field participates in change
// detection. The JSON string is also reused for the changed response below;
// this avoids serializing the large list a second time in NextResponse.json.
function serializeLiveProjection(data: LiveAggregateList): SerializedLiveProjection {
  const json = JSON.stringify(data);
  return {
    json,
    sig: createHash("sha256").update(json).digest("hex").slice(0, 16),
  };
}

function serializeLiveResponse(projectionJson: string, sig: string, generatedAt: number): string {
  if (projectionJson.length < 2 || projectionJson[0] !== "{" || projectionJson[projectionJson.length - 1] !== "}") {
    throw new Error("Live projection must serialize as a JSON object");
  }
  // sig is a lowercase hexadecimal digest and generatedAt is Date.now(), so
  // both are safe to append without another full-object JSON serialization.
  return `${projectionJson.slice(0, -1)},"sig":"${sig}","generatedAt":${generatedAt}}`;
}

function serializedJsonResponse(body: string): Response {
  return new Response(body, {
    headers: { ...CACHE_HEADERS, "Content-Type": "application/json" },
  });
}

const querySchema = z.object({
  harness: z.string().optional(),
  // Finite out-of-range limits are clamped (matching prior behavior);
  // non-numeric and non-finite input (limit=abc, limit=Infinity) is a 400.
  limit: queryNumber,
  sig: z.string().optional(),
});

export async function GET(request: Request) {
  const query = parseQuery(request, querySchema);
  if (!query.ok) return query.response;
  const { harness, sig: prevSig } = query.data;
  const limit = clampInt(query.data.limit ?? defaultLiveLimitForHarness(harness), 1, 1000);
  try {
    const data = await coalescedLiveScan(limit, harness);
    const projected = projectLiveAggregate(data);
    const serialized = serializeLiveProjection(projected);
    const generatedAt = Date.now();
    if (prevSig && prevSig === serialized.sig) {
      // Poller already holds identical content — skip re-serializing the full
      // aggregate (up to 200 sessions of tool/usage/trace detail per poll).
      return NextResponse.json({ unchanged: true, sig: serialized.sig, generatedAt }, { headers: CACHE_HEADERS });
    }
    return serializedJsonResponse(serializeLiveResponse(serialized.json, serialized.sig, generatedAt));
  } catch (error) {
    return internalError("Failed to scan live sessions", error);
  }
}
