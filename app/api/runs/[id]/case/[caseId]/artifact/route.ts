import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRunCaseByCaseId } from "@/lib/db";
import { resolveWithin } from "@/lib/config";
import { isTerminalCaseStatus } from "@/lib/status";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string; caseId: string }> }
) {
  const params = await props.params;
  const { id: runId, caseId } = params;
  const artifactPath = req.nextUrl.searchParams.get("path");

  if (!artifactPath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  const rc = getRunCaseByCaseId(runId, caseId);
  if (!rc) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  if (!rc.workdir_path || !path.isAbsolute(rc.workdir_path)) {
    return NextResponse.json({ error: "Case has no artifact workdir" }, { status: 404 });
  }

  // Resolve within the case workdir: blocks `..`/absolute-path escapes while
  // still allowing nested artifact subpaths (e.g. dist/index.html).
  const fullPath = resolveWithin(rc.workdir_path, artifactPath);
  if (!fullPath) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const realWorkdir = fs.realpathSync(rc.workdir_path);
    const realArtifact = fs.realpathSync(fullPath);
    const realRelative = path.relative(realWorkdir, realArtifact);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    const content = fs.readFileSync(realArtifact, "utf8");
    const isTerminal = isTerminalCaseStatus(rc.status);
    const headers = isTerminal
      ? { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" }
      : { "Cache-Control": "no-cache" };
    return NextResponse.json({ path: artifactPath, content }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Artifact not found. Run the case or oracle solve script first." },
      { status: 404 }
    );
  }
}
