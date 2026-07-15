import { NextResponse } from "next/server";
import { getRun, getRunCaseByCaseId } from "@/lib/db";
import { isTerminalCaseStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string; caseId: string }> }
) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const rc = getRunCaseByCaseId(params.id, params.caseId);
  if (!rc) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  const isTerminal = isTerminalCaseStatus(rc.status);
  const cacheHeaders = isTerminal
    ? { "Cache-Control": "private, max-age=120, stale-while-revalidate=600" }
    : { "Cache-Control": "no-cache" };
  return NextResponse.json({ case: rc }, { headers: cacheHeaders });
}
