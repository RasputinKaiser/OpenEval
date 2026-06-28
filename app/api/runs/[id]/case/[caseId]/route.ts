import { NextResponse } from "next/server";
import { getRun, listRunCases } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string; caseId: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const rc = listRunCases(params.id).find((item) => item.case_id === params.caseId || item.id === params.caseId);
  if (!rc) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  return NextResponse.json({ case: rc });
}
