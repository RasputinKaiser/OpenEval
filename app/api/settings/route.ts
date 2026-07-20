import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdapter } from "@/lib/adapters/registry";
import { resolveJudge } from "@/lib/grader/judge";
import { readAppSettings, saveAppSettings } from "@/lib/settings";
import { badRequest, internalError, parseJsonBody } from "@/lib/api-http";

export const dynamic = "force-dynamic";

function validSource(source: string): boolean {
  return source === "" || source === "openrouter" || hasAdapter(source);
}
function effectiveJudge() {
  const resolved = resolveJudge();
  return { source: resolved.harness, model: resolved.model ?? "", name: resolved.judgeName };
}

export async function GET() {
  try {
    const settings = readAppSettings();
    return NextResponse.json({
      settings,
      effectiveJudge: effectiveJudge(),
      environmentOverrides: {
        source: Boolean(process.env.JUDGE_HARNESS),
        model: Boolean(process.env.JUDGE_MODEL),
        openrouterKey: Boolean(process.env.OPENROUTER_API_KEY),
      },
      // Verbatim override values so Settings can show exactly what wins over the
      // saved selection. Harness/model ids only — never key material.
      environmentOverrideValues: {
        judgeHarness: process.env.JUDGE_HARNESS ?? null,
        judgeModel: process.env.JUDGE_MODEL ?? null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return internalError("Failed to read settings", error);
  }
}

const putBodySchema = z.object({
  judgeSource: z.string().trim().optional().default(""),
  judgeModel: z.string().trim().optional().default(""),
});

export async function PUT(req: Request) {
  const body = await parseJsonBody(req, putBodySchema);
  if (!body.ok) return body.response;
  const { judgeSource, judgeModel } = body.data;

  // Length checks stay outside the schema so the client-visible top-level
  // `error` message stays specific (SettingsClient renders it verbatim).
  if (judgeSource.length > 120) {
    return badRequest("Judge source is too long", { detail: "judgeSource must be at most 120 characters." });
  }
  if (judgeModel.length > 240) {
    return badRequest("Judge model is too long", { detail: "judgeModel must be at most 240 characters." });
  }
  if (!validSource(judgeSource)) {
    return badRequest(`Unknown judge source "${judgeSource}"`, {
      hint: "Use \"\", \"openrouter\", or a registered harness id from GET /api/harnesses.",
    });
  }

  try {
    const settings = saveAppSettings({ judgeSource, judgeModel });
    return NextResponse.json({ settings, effectiveJudge: effectiveJudge() });
  } catch (error) {
    return internalError("Failed to save settings", error);
  }
}
