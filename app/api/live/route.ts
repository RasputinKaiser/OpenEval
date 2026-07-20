import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { defaultLiveLimitForHarness, scanLiveSessions, type LiveAggregate } from "@/lib/live";
import { clampInt, internalError, parseQuery, queryNumber } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" } as const;

// Content signature over identity-bearing fields only. Time-derived values
// (staleMs is restamped from Date.now() on every scan) are deliberately
// excluded so an idle source keeps a stable signature; the client derives
// staleness from lastEventAt instead.
function computeSignature(data: LiveAggregate): string {
  // Change-detection fingerprint, not a security boundary — but sha256 keeps
  // static analysis quiet at identical cost for these payload sizes.
  const hash = createHash("sha256");
  hash.update([
    data.sourceHarness,
    data.sourceStatus,
    data.sourceMessage ?? "",
    data.totalSessions,
    data.totalProjects,
    data.totalToolCalls,
    data.totalToolErrors,
    data.usageSummary.totalTokens,
    data.usageSummary.totalCostUsd,
    data.avgDataQuality,
    data.archivedSessions,
    data.scanWarnings.join("\u0000"),
  ].join("|"));
  for (const s of data.sessions) {
    hash.update(`|${s.sessionId}\u0000${s.project}\u0000${s.model ?? ""}\u0000${s.lastEventAt}\u0000${s.lineCount}\u0000${s.pathBytes}\u0000${s.toolCalls}\u0000${s.toolErrors}\u0000${s.hookErrors}\u0000${s.isError ? 1 : 0}\u0000${s.dataQuality}\u0000${s.archived ? 1 : 0}`);
  }
  return hash.digest("hex").slice(0, 16);
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
    const data = scanLiveSessions(limit, harness);
    const sig = computeSignature(data);
    if (prevSig && prevSig === sig) {
      // Poller already holds identical content — skip re-serializing the full
      // aggregate (up to 200 sessions of tool/usage/trace detail per poll).
      return NextResponse.json({ unchanged: true, sig, generatedAt: Date.now() }, { headers: CACHE_HEADERS });
    }
    return NextResponse.json({ ...data, sig, generatedAt: Date.now() }, { headers: CACHE_HEADERS });
  } catch (error) {
    return internalError("Failed to scan live sessions", error);
  }
}
