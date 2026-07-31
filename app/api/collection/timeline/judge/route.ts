import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { collectAllPoints } from "@/lib/insights/collect";
import { judgePoints, startJudgeAll, judgeJobStatus } from "@/lib/insights/judge";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * LLM-judge passes over sampled sessions. Each judgment is a real CLI
 * invocation of the judge harness (JUDGE_HARNESS, default codex), so judging
 * is explicitly user-triggered — never part of a page render.
 *
 * POST {max: n}    — synchronous pass over up to n unjudged sampled sessions.
 * POST {all: true} — start a background job judging EVERY unjudged
 *                    marker-window session; returns immediately.
 * GET              — background job status (poll while running).
 */
export async function POST(req: Request) {
  let max = 10;
  let all = false;
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && Number.isFinite(body.max)) max = body.max;
    if (body?.all === true) all = true;
  } catch {
    // empty body → defaults
  }
  try {
    const { points, markers } = collectAllPoints();
    if (all) {
      const { started, status } = startJudgeAll(points, markers);
      return NextResponse.json({ mode: "all", started, status }, { headers: NO_STORE_HEADERS });
    }
    const result = await judgePoints(points, markers, { max });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return apiError(500, "Timeline judge unavailable", {
      detail: error instanceof Error ? error.message : String(error),
      headers: NO_STORE_HEADERS,
    });
  }
}

export async function GET() {
  try {
    return NextResponse.json(judgeJobStatus(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return apiError(500, "Timeline judge status unavailable", {
      detail: error instanceof Error ? error.message : String(error),
      headers: NO_STORE_HEADERS,
    });
  }
}
