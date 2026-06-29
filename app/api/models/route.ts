import { NextResponse } from "next/server";
import { discoverModels, isValidModelId } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const models = discoverModels();
  return NextResponse.json(
    { models, defaultModel: models[0]?.id ?? null },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
  );
}

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({} as { id?: string }));
  return NextResponse.json({ valid: isValidModelId(id), id });
}