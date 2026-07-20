import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverHarnesses, probeHarness } from "@/lib/adapters/discover";
import { getDefaultHarness, getAllDescriptorIssues } from "@/lib/adapters/registry";
import { internalError, notFound, parseJsonBody, parseQuery, queryFlag } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const getQuerySchema = z.object({ refresh: queryFlag });
const probeBodySchema = z.object({ id: z.string().trim().min(1, "id required") });

export async function GET(request: Request) {
  const query = parseQuery(request, getQuerySchema);
  if (!query.ok) return query.response;
  try {
    const harnesses = await discoverHarnesses(query.data.refresh);
    const available = harnesses.filter((h) => h.status === "available");
    return NextResponse.json(
      {
        harnesses,
        defaultHarness: getDefaultHarness(),
        availableCount: available.length,
        descriptorIssues: getAllDescriptorIssues(),
      },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } }
    );
  } catch (error) {
    return internalError("Failed to discover harnesses", error);
  }
}

export async function POST(req: Request) {
  const body = await parseJsonBody(req, probeBodySchema);
  if (!body.ok) return body.response;
  try {
    const result = await probeHarness(body.data.id);
    if (!result) {
      return notFound("Unknown harness", {
        detail: `No harness with id "${body.data.id}" is registered.`,
        hint: "GET /api/harnesses lists the known harness ids.",
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return internalError("Failed to probe harness", error);
  }
}
