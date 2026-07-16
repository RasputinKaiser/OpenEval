import { NextResponse } from "next/server";
import { configuredDefaultModel, discoverModels, isValidModelId } from "@/lib/models";
import { getAdapter, hasAdapter } from "@/lib/adapters/registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const harness = searchParams.get("harness") ?? undefined;
  const models = discoverModels(harness);
  const descriptorDefault = harness && hasAdapter(harness) ? getAdapter(harness).descriptor.models?.default : undefined;
  const localDefault = harness ? configuredDefaultModel(harness) : undefined;
  return NextResponse.json(
    { models, defaultModel: descriptorDefault ?? localDefault ?? models[0]?.id ?? null },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
  );
}

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({} as { id?: string }));
  return NextResponse.json({ valid: isValidModelId(id), id });
}
