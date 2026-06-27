import { NextResponse } from "next/server";
import { scanLiveSessions } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = scanLiveSessions(200);
  return NextResponse.json(data);
}