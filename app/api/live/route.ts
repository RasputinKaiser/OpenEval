import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { defaultLiveLimitForHarness, scanLiveSessions, type LiveAggregate } from "@/lib/live";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" } as const;

// Content signature over identity-bearing fields only. Time-derived values
// (staleMs is restamped from Date.now() on every scan) are deliberately
// excluded so an idle source keeps a stable signature; the client derives
// staleness from lastEventAt instead.
function computeSignature(data: LiveAggregate): string {
  const hash = createHash("sha1");
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const harness = searchParams.get("harness") || undefined;
  const parsedLimit = Number(searchParams.get("limit") || defaultLiveLimitForHarness(harness));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(1000, parsedLimit)) : defaultLiveLimitForHarness(harness);
  const data = scanLiveSessions(limit, harness);
  const sig = computeSignature(data);
  const prevSig = searchParams.get("sig");
  if (prevSig && prevSig === sig) {
    // Poller already holds identical content — skip re-serializing the full
    // aggregate (up to 200 sessions of tool/usage/trace detail per poll).
    return NextResponse.json({ unchanged: true, sig, generatedAt: Date.now() }, { headers: CACHE_HEADERS });
  }
  return NextResponse.json({ ...data, sig, generatedAt: Date.now() }, { headers: CACHE_HEADERS });
}
