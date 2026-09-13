import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { createExperiment, getExperiment, listExperiments, type ExperimentInput } from "@/lib/experiments";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 512_000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  try {
    if (id) {
      const experiment = getExperiment(id);
      if (!experiment) return apiError(404, "Experiment not found", { detail: "The saved experiment ID is unavailable.", headers });
      return NextResponse.json({ experiment }, { headers });
    }
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isFinite(limit) || limit < 1) return apiError(400, "Invalid experiment limit", { detail: "limit must be a positive finite number.", field: "limit", headers });
    return NextResponse.json({ experiments: listExperiments(limit) }, { headers });
  } catch (error) {
    return apiError(400, "Invalid experiment request", { detail: error instanceof Error ? error.message : String(error), headers });
  }
}

export async function POST(request: Request) {
  let raw: string;
  try { raw = await request.text(); } catch { return apiError(400, "Experiment request body could not be read", { headers }); }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return apiError(413, "Experiment request is too large", { detail: `JSON is limited to ${MAX_BODY_BYTES} bytes.`, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return apiError(400, "Experiment request must be valid JSON", { headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "Experiment request must be an object", { headers });
  try {
    const experiment = createExperiment(body as ExperimentInput);
    return NextResponse.json({ experiment }, { status: 201, headers });
  } catch (error) {
    return apiError(400, "Invalid experiment", { detail: error instanceof Error ? error.message : String(error), headers });
  }
}
