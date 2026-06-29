import { NextResponse } from "next/server";
import { getRun, getRunCaseByCaseId } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string; caseId: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const rc = getRunCaseByCaseId(params.id, params.caseId);
  if (!rc) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  return NextResponse.json({ case: rc });
}
