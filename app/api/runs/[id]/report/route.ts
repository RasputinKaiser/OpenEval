import { NextResponse } from "next/server";
import { getRun } from "@/lib/db";
import { buildRunReport } from "@/lib/report";

export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const markdown = await buildRunReport(params.id, { redact: url.searchParams.get("redact") === "1" });
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="openeval-run-${params.id}.md"`,
    },
  });
}
