import { NextResponse } from "next/server";
import { discoverModels, isValidModelId, resolveDefaultModel } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const harness = searchParams.get("harness") ?? undefined;
  const models = discoverModels(harness);
  const resolvedDefault = harness ? resolveDefaultModel(harness) : { source: "none" as const };
  return NextResponse.json(
    { models, defaultModel: resolvedDefault.id ?? models[0]?.id ?? null, defaultModelSource: resolvedDefault.source },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
  );
}

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({} as { id?: string }));
  return NextResponse.json({ valid: isValidModelId(id), id });
}
