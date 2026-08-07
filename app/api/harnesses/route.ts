import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverHarnesses, probeHarness, type DiscoveredHarness } from "@/lib/adapters/discover";
import { getDefaultHarness, getAllDescriptorIssues } from "@/lib/adapters/registry";
import {
  DescriptorConflictError,
  DescriptorMutationError,
  descriptorPreview,
  disconnectDescriptor,
  getHarnessRegistration,
  getRegistrationRecords,
  readinessForHarness,
  registerDescriptor,
} from "@/lib/adapters/connection-center";
import { badRequest, internalError, notFound, parseJsonBody, parseQuery, queryFlag } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const getQuerySchema = z.object({ refresh: queryFlag });
const probeBodySchema = z.object({ id: z.string().trim().min(1, "id required") });
const actionBodySchema = z.object({ action: z.literal("validate"), descriptor: z.unknown() }).strict();
const registerBodySchema = z.object({ descriptor: z.unknown(), expectedRevision: z.string().trim().min(1).optional() }).strict();

function withConnectionState(harness: DiscoveredHarness) {
  const registration = getHarnessRegistration(harness.id);
  return { ...harness, registration, readiness: readinessForHarness(harness, registration) };
}

export async function GET(request: Request) {
  const query = parseQuery(request, getQuerySchema);
  if (!query.ok) return query.response;
  try {
    const harnesses = (await discoverHarnesses(query.data.refresh)).map(withConnectionState);
    const available = harnesses.filter((h) => h.status === "available");
    return NextResponse.json(
      {
        harnesses,
        defaultHarness: getDefaultHarness(),
        availableCount: available.length,
        descriptorIssues: getAllDescriptorIssues(),
        registrations: getRegistrationRecords(),
      },
      {
        headers: {
          "Cache-Control": query.data.refresh
            ? "private, no-store"
            : "private, max-age=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    return internalError("Failed to discover harnesses", error);
  }
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (raw && typeof raw === "object" && "action" in raw && raw.action === "validate") {
    const body = actionBodySchema.safeParse(raw);
    if (!body.success) return badRequest("Invalid descriptor preview request", { detail: body.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") });
    try {
      return NextResponse.json(descriptorPreview(body.data.descriptor));
    } catch (error) {
      return mutationError(error);
    }
  }
  const body = probeBodySchema.safeParse(raw);
  if (!body.success) return badRequest("Invalid request body", { detail: body.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") });
  try {
    const result = await probeHarness(body.data.id);
    if (!result) {
      return notFound("Unknown harness", {
        detail: `No harness with id "${body.data.id}" is registered.`,
        hint: "GET /api/harnesses lists the known harness ids.",
      });
    }
    return NextResponse.json(withConnectionState(result));
  } catch (error) {
    return internalError("Failed to probe harness", error);
  }
}

export async function PUT(req: Request) {
  const body = await parseJsonBody(req, registerBodySchema);
  if (!body.ok) return body.response;
  try {
    const result = registerDescriptor(body.data.descriptor, body.data.expectedRevision);
    const discovered = await discoverHarnesses(true);
    const harness = discovered.find((item) => item.id === result.descriptor.id);
    return NextResponse.json({
      descriptor: result.descriptor,
      registration: result.registration,
      harness: harness ? withConnectionState(harness) : null,
    }, { status: 200 });
  } catch (error) {
    return mutationError(error);
  }
}

export async function DELETE(req: Request) {
  const query = z.object({ id: z.string().trim().min(1, "id required"), expectedRevision: z.string().trim().min(1).optional() }).safeParse({
    id: new URL(req.url).searchParams.get("id") ?? "",
    expectedRevision: new URL(req.url).searchParams.get("expectedRevision") ?? undefined,
  });
  if (!query.success) return badRequest("id required", { detail: query.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") });
  try {
    const result = disconnectDescriptor(query.data.id, query.data.expectedRevision);
    const discovered = await discoverHarnesses(true);
    const harness = discovered.find((item) => item.id === query.data.id);
    return NextResponse.json({ ...result, harness: harness ? withConnectionState(harness) : null });
  } catch (error) {
    return mutationError(error);
  }
}

function mutationError(error: unknown) {
  if (error instanceof DescriptorConflictError) return NextResponse.json({ error: error.message, detail: `Current revision: ${error.currentRevision}. Reload the registry before retrying.` }, { status: 409 });
  if (error instanceof DescriptorMutationError) return badRequest(error.message);
  return internalError("Harness connection update failed", error);
}
