import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverModels, isValidModelId, resolveDefaultModel } from "@/lib/models";
import { internalError, parseJsonBody, parseQuery } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const getQuerySchema = z.object({ harness: z.string().optional() });
const validateBodySchema = z.object({ id: z.string().min(1, "id required") });

export async function GET(request: Request) {
  const query = parseQuery(request, getQuerySchema);
  if (!query.ok) return query.response;
  const { harness } = query.data;
  try {
    const models = discoverModels(harness);
    const resolvedDefault = harness ? resolveDefaultModel(harness) : { source: "none" as const };
    return NextResponse.json(
      { models, defaultModel: resolvedDefault.id ?? models[0]?.id ?? null, defaultModelSource: resolvedDefault.source },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    return internalError("Failed to discover models", error);
  }
}

export async function POST(req: Request) {
  const body = await parseJsonBody(req, validateBodySchema);
  if (!body.ok) return body.response;
  return NextResponse.json({ valid: isValidModelId(body.data.id), id: body.data.id });
}
