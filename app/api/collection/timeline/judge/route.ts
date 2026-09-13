import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { collectAllPoints } from "@/lib/insights/collect";
import { judgePoints, startJudgeAll, judgeJobStatus } from "@/lib/insights/judge";
import { previewJudgeQueue, judgeQueueMetadata } from "@/lib/insights/judge-queue";
import { makeJudgeSelection, requireReadyJudgeSelection, type JudgeSelectionInput } from "@/lib/grader/selection";
import { loadJudgments, loadLatestJudgeReceipts } from "@/lib/live-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

const QueueFiltersSchema = z.object({
  from: z.number().int().min(0).max(8.64e15).optional(), to: z.number().int().min(0).max(8.64e15).optional(),
  source: z.string().trim().min(1).max(256).optional(), model: z.string().trim().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  reasons: z.array(z.enum(["gap", "uncertain", "disagreement", "changed", "balanced"])).max(5).optional(),
}).strict().refine(value => value.from == null || value.to == null || value.to > value.from, { message: "The upper date bound must be after the lower bound" });

function publicQueuePreview(preview: Awaited<ReturnType<typeof previewJudgeQueue>>) {
  return {
    ...preview,
    // Absolute transcript paths are server authority and are never part of a
    // browser queue contract. The worker rehydrates paths from its collection.
    items: preview.items.map(({ path: _path, ...item }) => item),
  };
}

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
 * POST {all: true} — start a bounded background review; returns immediately.
 * More than four selected sessions also use the durable background job.
 * GET              — background job status (poll while running).
 */
export async function POST(req: Request) {
  let max = 10;
  let all = false;
  let selectionInput: JudgeSelectionInput | undefined;
  let selectionWasExplicit = false;
  let preview = false;
  let queueFilters: Parameters<typeof previewJudgeQueue>[1] = {};
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && Number.isFinite(body.max)) max = body.max;
    if (body?.all === true) all = true;
    preview = body?.preview === true || body?.queue === true;
    if (body?.max !== undefined && (typeof body.max !== "number" || !Number.isInteger(body.max) || body.max < 1 || body.max > 50)) throw new Error("max must be an integer from 1 to 50");
    if (body?.all !== undefined && typeof body.all !== "boolean") throw new Error("all must be a boolean");
    if (body?.filters !== undefined) queueFilters = QueueFiltersSchema.parse(body.filters);
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
  } catch (error) {
    return apiError(400, "Invalid review request", { detail: error instanceof Error ? error.message : "Invalid request body", headers: NO_STORE_HEADERS });
  }
  if (preview) {
    try {
      const { points, markers } = collectAllPoints();
      return NextResponse.json(publicQueuePreview(previewJudgeQueue({
        points,
        markers,
        judgments: loadJudgments(),
        receipts: loadLatestJudgeReceipts(),
        evidence: judgeQueueMetadata(points),
        selection: selectionInput ? makeJudgeSelection({ ...selectionInput, resolution: "job" }) : undefined,
      }, queueFilters)), { headers: NO_STORE_HEADERS });
    } catch (error) {
      return apiError(500, "Timeline judge queue unavailable", {
        detail: error instanceof Error ? error.message : String(error),
        headers: NO_STORE_HEADERS,
      });
    }
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
    // Execution is always materialized from the same bounded queue contract
    // exposed by preview. This keeps filters, reasons, and the selected limit
    // causal instead of showing one population and judging another.
    const executionFilters = { ...queueFilters, limit: Math.max(1, Math.min(50, Math.floor(queueFilters.limit ?? max))) };
    const executionQueue = previewJudgeQueue({
      points,
      markers,
      judgments: loadJudgments(),
      receipts: loadLatestJudgeReceipts(),
      evidence: judgeQueueMetadata(points),
      selection,
    }, executionFilters);
    const executionPaths = new Set(executionQueue.items.map((item) => item.path));
    if (all || executionQueue.items.length > 4) {
      if (synchronousJudgeInFlight || judgeJobStatus().running) {
        return apiError(409, "Timeline judge already running", { detail: "Wait for the current judge pass to finish before starting another one.", headers: NO_STORE_HEADERS });
      }
      const { started, status } = startJudgeAll(points, markers, {
        cap: executionQueue.items.length,
        paths: executionPaths,
        forcePaths: executionPaths,
        selection,
      });
      return NextResponse.json({ mode: "all", started, status }, { headers: NO_STORE_HEADERS });
    }
    if (synchronousJudgeInFlight || judgeJobStatus().running) {
      return apiError(409, "Timeline judge already running", { detail: "Wait for the current judge pass to finish before starting another one.", headers: NO_STORE_HEADERS });
    }
    synchronousJudgeInFlight = true;
    try {
      const result = await judgePoints(points, [], {
        max: executionQueue.items.length,
        paths: executionPaths,
        forcePaths: executionPaths,
        selection,
      });
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

export function GET(): Promise<Response>;
export function GET(req: Request): Promise<Response>;
export async function GET(req: Request = new Request("http://localhost/api/collection/timeline/judge")) {
  try {
    const url = req ? new URL(req.url) : null;
    if (url?.searchParams.get("preview") === "1" || url?.searchParams.get("queue") === "1") {
      const reasons = url.searchParams.getAll("reason");
      const fromRaw = url.searchParams.get("from");
      const toRaw = url.searchParams.get("to");
      const limitRaw = url.searchParams.get("limit");
      const from = fromRaw == null || fromRaw.trim() === "" ? null : Number(fromRaw);
      const to = toRaw == null || toRaw.trim() === "" ? null : Number(toRaw);
      const limit = limitRaw == null || limitRaw.trim() === "" ? null : Number(limitRaw);
      const filters = QueueFiltersSchema.safeParse({
        ...(from != null ? { from } : {}), ...(to != null ? { to } : {}), ...(limit != null ? { limit } : {}),
        ...(url.searchParams.has("source") ? { source: url.searchParams.get("source") } : {}),
        ...(url.searchParams.has("model") ? { model: url.searchParams.get("model") } : {}),
        ...(reasons.length ? { reasons } : {}),
      });
      if (!filters.success) return apiError(400, "Invalid review filters", { detail: filters.error.message, headers: NO_STORE_HEADERS });
      const { points, markers } = collectAllPoints();
      return NextResponse.json(publicQueuePreview(previewJudgeQueue({
        points, markers, judgments: loadJudgments(), receipts: loadLatestJudgeReceipts(), evidence: judgeQueueMetadata(points),
      }, filters.data)), { headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(judgeJobStatus(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return apiError(500, "Timeline judge status unavailable", {
      detail: error instanceof Error ? error.message : String(error),
      headers: NO_STORE_HEADERS,
    });
  }
}
