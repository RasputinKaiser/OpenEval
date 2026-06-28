import { NextResponse } from "next/server";
import { discoverHarnesses, probeHarness } from "@/lib/adapters/discover";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";
  const harnesses = await discoverHarnesses(refresh);
  const available = harnesses.filter((h) => h.status === "available");
  return NextResponse.json({
    harnesses,
    defaultHarness: "ncode",
    availableCount: available.length,
  });
}

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({} as { id?: string }));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = await probeHarness(id);
  if (!result) return NextResponse.json({ error: "unknown harness" }, { status: 404 });
  return NextResponse.json(result);
}
