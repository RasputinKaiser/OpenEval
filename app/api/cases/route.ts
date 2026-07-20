import { NextResponse } from "next/server";
import { loadCases } from "@/lib/cases";
import { internalError } from "@/lib/api-http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cases = await loadCases();
    return NextResponse.json(
      { cases },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    return internalError("Failed to load cases", error);
  }
}
