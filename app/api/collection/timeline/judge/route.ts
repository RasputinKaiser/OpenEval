import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { collectAllPoints } from "@/lib/insights/collect";
import { judgePoints, startJudgeAll, judgeJobStatus } from "@/lib/insights/judge";
import { makeJudgeSelection, requireReadyJudgeSelection, type JudgeSelectionInput } from "@/lib/grader/selection";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

// Synchronous passes do not have a durable worker row, so keep a local guard
// for duplicate button clicks and refuse to overlap them with judge-all. The
// durable all-job lease remains authoritative across processes/HMR.
let synchronousJudgeInFlight = false;

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
  let selectionInput: JudgeSelectionInput | undefined;
  let selectionWasExplicit = false;
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && Number.isFinite(body.max)) max = body.max;
    if (body?.all === true) all = true;
    if (body?.selection !== undefined) {
      selectionWasExplicit = true;
      if (!body.selection || typeof body.selection !== "object" || Array.isArray(body.selection)) throw new Error("selection must be an object");
      const source = typeof body.selection.source === "string" ? body.selection.source.trim() : "";
      const model = typeof body.selection.model === "string" ? body.selection.model.trim() : "";
      if (!source) throw new Error("selection.source is required");
      if (!model) throw new Error("selection.model is required");
      const effort = body.selection.reasoningEffort;
      if (effort !== undefined && typeof effort !== "string") throw new Error("selection.reasoningEffort must be a string");
      selectionInput = { source, model, reasoningEffort: effort };
    }
  } catch {
    if (selectionWasExplicit) {
      return apiError(400, "Invalid judge selection", { detail: "selection must include a source and model", headers: NO_STORE_HEADERS });
    }
    // empty body → defaults
  }
  if (!selectionWasExplicit) {
    return apiError(400, "Explicit judge selection required", { detail: "selection must include a source and model for this job", headers: NO_STORE_HEADERS });
  }
  try {
    if (!Number.isInteger(max) || max < 1 || max > 50) {
      return apiError(400, "Invalid judge sample size", { detail: "max must be an integer between 1 and 50", headers: NO_STORE_HEADERS });
    }
    const selection = await requireReadyJudgeSelection(makeJudgeSelection({ ...selectionInput, resolution: "job" }));
    const { points, markers } = collectAllPoints();
    if (all) {
      if (synchronousJudgeInFlight || judgeJobStatus().running) {
        return apiError(409, "Timeline judge already running", { detail: "Wait for the current judge pass to finish before starting another one.", headers: NO_STORE_HEADERS });
      }
      const { started, status } = startJudgeAll(points, markers, { selection });
      return NextResponse.json({ mode: "all", started, status }, { headers: NO_STORE_HEADERS });
    }
    if (synchronousJudgeInFlight || judgeJobStatus().running) {
      return apiError(409, "Timeline judge already running", { detail: "Wait for the current judge pass to finish before starting another one.", headers: NO_STORE_HEADERS });
    }
    synchronousJudgeInFlight = true;
    try {
      const result = await judgePoints(points, markers, { max, selection });
      return NextResponse.json(result, { headers: NO_STORE_HEADERS });
    } finally {
      synchronousJudgeInFlight = false;
    }
  } catch (error) {
    if (error instanceof Error && /Judge selection .* rejected/.test(error.message)) {
      return apiError(400, "Judge selection rejected", { detail: error.message, headers: NO_STORE_HEADERS });
    }
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
