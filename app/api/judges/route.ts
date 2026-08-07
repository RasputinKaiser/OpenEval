import { NextResponse } from "next/server";
import { checkJudgeSelection, makeJudgeSelection } from "@/lib/grader/selection";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = [
    { id: "codex", label: "Codex subscription", model: "gpt-5.6-luna", effort: "high" },
    { id: "claude-code", label: "Claude", model: "sonnet", effort: null },
    { id: "stub", label: "Deterministic stub", model: "deterministic-v1", effort: null },
    // OpenRouter is an opt-in transport. Do not advertise a choice that the
    // job preflight will necessarily reject just because the package knows
    // its default model; the API key is the configured-readiness boundary.
    ...(process.env.OPENROUTER_API_KEY ? [{ id: "openrouter", label: "OpenRouter", model: "tencent/hy3:free", effort: null }] : []),
  ] as const;
  const choices = await Promise.all(sources.map(async (source) => {
    const selection = await checkJudgeSelection(makeJudgeSelection({ source: source.id, model: source.model, reasoningEffort: source.effort, resolution: "fallback" }));
    return { ...source, selection };
  }));
  return NextResponse.json({ sources: choices }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
