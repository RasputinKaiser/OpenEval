import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { parseChartSelection } from "@/lib/chart-analysis";
import { collectAllPoints, buildTimeline } from "@/lib/insights/collect";
import { filterAnalysisSessions } from "@/lib/collection/analysis";
import { getCollectionSnapshot, getTimelineSnapshot } from "@/lib/collection/snapshot-service";

export const dynamic = "force-dynamic";

function hasVizSelection(selection: ReturnType<typeof parseChartSelection>["selection"]): boolean {
  return Object.keys(selection).length > 0;
}

function sessionKey(sourceId: string | undefined, sessionId: string): string {
  return `${sourceId ?? ""}\u0000${sessionId}`;
}

/** Longitudinal report: adoption markers + before/after impact + outcome trend. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseChartSelection(searchParams);
  if (parsed.error) return apiError(400, "Invalid chart selection", { detail: parsed.error, field: "viz" });
  const forceRefresh = searchParams.get("fresh") === "1";
  const rawGeneration = searchParams.get("generation");
  let requestedGeneration: number | undefined;
  if (rawGeneration !== null) {
    const generation = Number(rawGeneration);
    if (!Number.isFinite(generation)) return apiError(400, "Invalid snapshot generation", { field: "generation" });
    requestedGeneration = generation;
  }
  const cacheControl = forceRefresh
    ? "private, no-store, max-age=0"
    : "private, max-age=30, stale-while-revalidate=120";
  try {
    if (hasVizSelection(parsed.selection) || requestedGeneration !== undefined) {
      const snapshot = await getCollectionSnapshot({ forceRefresh });
      if (requestedGeneration !== undefined && requestedGeneration !== snapshot.generatedAtMs) {
        return NextResponse.json(
          { error: "collection snapshot changed; restart timeline pagination", generatedAtMs: snapshot.generatedAtMs },
          { status: 409, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const collection = snapshot.value.sessions;
      // Session predicates are source/date/model/tool/time based. Outcome
      // provenance is applied only after current judgments are resolved by
      // collectAllPoints; silently filtering on the heuristic score would make
      // a vizOutcome=judged request look valid while ignoring receipts.
      const baseSelection = { ...parsed.selection, outcome: undefined };
      let selected = filterAnalysisSessions(collection, baseSelection);
      if (parsed.selection.outcome !== undefined) {
        const points = collectAllPoints(selected).points;
        const wanted = new Set(points
          .filter((point) => point.outcomeProvenance === parsed.selection.outcome)
          .map((point) => sessionKey(point.sourceId, point.sessionId)));
        selected = selected.filter((session) => wanted.has(sessionKey(session.sourceId, session.sessionId)));
      }
      const report = buildTimeline(selected);
      return NextResponse.json({
        ...report,
        selection: parsed.selection,
        population: collection.length,
        totalMatched: selected.length,
        evidence: {
          population: collection.length,
          eligible: selected.length,
          plotted: report.outcomeScatterEvidence.plotted ?? report.outcomeScatter.length,
          scope: "parsed snapshot",
          provenance: "collection snapshot",
          generatedAtMs: snapshot.generatedAtMs,
          stale: snapshot.stale,
          partial: snapshot.partial || snapshot.value.aggregate.partial,
          refreshing: snapshot.refreshing,
          ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
        },
        generatedAtMs: snapshot.generatedAtMs,
        stale: snapshot.stale,
        refreshing: snapshot.refreshing,
        ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
      }, { headers: { "Cache-Control": cacheControl } });
    }
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
