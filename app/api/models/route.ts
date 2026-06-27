import { NextResponse } from "next/server";
import { discoverModels, isValidModelId } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const models = discoverModels();
  return NextResponse.json({ models, defaultModel: models[0]?.id ?? null });
}

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({} as { id?: string }));
  return NextResponse.json({ valid: isValidModelId(id), id });
}