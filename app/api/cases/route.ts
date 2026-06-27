import { NextResponse } from "next/server";
import { loadCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

export async function GET() {
  const cases = await loadCases();
  return NextResponse.json({ cases });
}