import { NextResponse } from "next/server";
import { collectAllPoints } from "@/lib/insights/collect";
import { judgePoints, startJudgeAll, judgeJobStatus } from "@/lib/insights/judge";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

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
  const { points, markers } = collectAllPoints();
  if (all) {
    const { started, status } = startJudgeAll(points, markers);
    return NextResponse.json({ mode: "all", started, status });
  }
  const result = await judgePoints(points, markers, { max });
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json(judgeJobStatus());
}
