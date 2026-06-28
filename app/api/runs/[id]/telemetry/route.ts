import { NextResponse } from "next/server";
import { getRun, listRunCases } from "@/lib/db";
import { computeTelemetry } from "@/lib/summary";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const cases = listRunCases(params.id);
  const telemetry = computeTelemetry(cases);
  return NextResponse.json({ telemetry });
}
