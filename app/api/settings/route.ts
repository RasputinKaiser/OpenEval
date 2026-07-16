import { NextResponse } from "next/server";
import { hasAdapter } from "@/lib/adapters/registry";
import { resolveJudge } from "@/lib/grader/judge";
import { readAppSettings, saveAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

function validSource(source: string): boolean {
  return source === "" || source === "openrouter" || hasAdapter(source);
}
function effectiveJudge() {
  const resolved = resolveJudge();
  return { source: resolved.harness, model: resolved.model ?? "", name: resolved.judgeName };
}

export async function GET() {
  const settings = readAppSettings();
  return NextResponse.json({
    settings,
    effectiveJudge: effectiveJudge(),
    environmentOverrides: {
      source: Boolean(process.env.JUDGE_HARNESS),
      model: Boolean(process.env.JUDGE_MODEL),
      openrouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const judgeSource = typeof body.judgeSource === "string" ? body.judgeSource.trim() : "";
  const judgeModel = typeof body.judgeModel === "string" ? body.judgeModel.trim() : "";

  if (judgeSource.length > 120) {
    return NextResponse.json({ error: "Judge source is too long" }, { status: 400 });
  }
  if (judgeModel.length > 240) {
    return NextResponse.json({ error: "Judge model is too long" }, { status: 400 });
  }
  if (!validSource(judgeSource)) {
    return NextResponse.json({ error: `Unknown judge source \"${judgeSource}\"` }, { status: 400 });
  }

  const settings = saveAppSettings({ judgeSource, judgeModel });
  return NextResponse.json({ settings, effectiveJudge: effectiveJudge() });
}
