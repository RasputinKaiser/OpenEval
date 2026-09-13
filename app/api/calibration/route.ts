import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import {
  buildCalibrationReport,
  createCalibrationReference,
  importCalibrationObservations,
  listCalibrationObservations,
  listCalibrationReferences,
  type CalibrationReferenceInput,
  type CalibrationObservationInput,
} from "@/lib/calibration";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 512_000;

export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view") ?? "report";
  try {
    if (view === "references") return NextResponse.json({ references: listCalibrationReferences() }, { headers });
    if (view === "observations") return NextResponse.json({ observations: listCalibrationObservations() }, { headers });
    if (view === "report") return NextResponse.json(buildCalibrationReport(), { headers });
    return apiError(400, "Unknown calibration view", { detail: "Use report, references, or observations.", field: "view", headers });
  } catch (error) {
    return apiError(500, "Calibration data unavailable", { detail: error instanceof Error ? error.message : String(error), headers });
  }
}

export async function POST(request: Request) {
  let raw: string;
  try { raw = await request.text(); } catch { return apiError(400, "Calibration request body could not be read", { headers }); }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return apiError(413, "Calibration request is too large", { detail: `JSON is limited to ${MAX_BODY_BYTES} bytes.`, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return apiError(400, "Calibration request must be valid JSON", { headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "Calibration request must be an object", { headers });
  const action = (body as { action?: unknown }).action;
  try {
    if (action === "create_reference") {
      const input = (body as { reference?: unknown }).reference;
      if (!input || typeof input !== "object" || Array.isArray(input)) return apiError(400, "A reference object is required", { field: "reference", headers });
      const reference = createCalibrationReference(input as CalibrationReferenceInput);
      return NextResponse.json({ reference }, { status: 201, headers });
    }
    if (action === "import_observations") {
      const observations = (body as { observations?: unknown }).observations;
      if (!Array.isArray(observations)) return apiError(400, "An observations array is required", { field: "observations", headers });
      const result = importCalibrationObservations(observations as CalibrationObservationInput[]);
      return NextResponse.json({ ...result, report: buildCalibrationReport() }, { headers });
    }
    return apiError(400, "Unknown calibration action", { detail: "Use create_reference or import_observations.", field: "action", headers });
  } catch (error) {
    return apiError(400, "Invalid calibration data", { detail: error instanceof Error ? error.message : String(error), headers });
  }
}
