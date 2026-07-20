import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getRunCaseByCaseId } from "@/lib/db";
import { resolveWithin } from "@/lib/config";
import { isTerminalCaseStatus } from "@/lib/status";
import { badRequest, notFound, parseQuery } from "@/lib/api-http";

const querySchema = z.object({
  path: z.string().min(1, "path is required"),
});

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string; caseId: string }> }
) {
  const params = await props.params;
  const { id: runId, caseId } = params;
  const query = parseQuery(req, querySchema);
  if (!query.ok) return query.response;
  const artifactPath = query.data.path;

  const rc = getRunCaseByCaseId(runId, caseId);
  if (!rc) {
    return notFound("Case not found", { detail: `Run "${runId}" has no case "${caseId}".` });
  }
  if (!rc.workdir_path || !path.isAbsolute(rc.workdir_path)) {
    return notFound("Case has no artifact workdir");
  }

  // Resolve within the case workdir: blocks `..`/absolute-path escapes while
  // still allowing nested artifact subpaths (e.g. dist/index.html).
  const fullPath = resolveWithin(rc.workdir_path, artifactPath);
  if (!fullPath) {
    return badRequest("Invalid path", { detail: "Artifact paths must stay inside the case workdir." });
  }

  try {
    const realWorkdir = fs.realpathSync(rc.workdir_path);
    const realArtifact = fs.realpathSync(fullPath);
    const realRelative = path.relative(realWorkdir, realArtifact);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return badRequest("Invalid path", { detail: "Artifact paths must stay inside the case workdir." });
    }
    const content = fs.readFileSync(realArtifact, "utf8");
    const isTerminal = isTerminalCaseStatus(rc.status);
    const headers = isTerminal
      ? { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" }
      : { "Cache-Control": "no-cache" };
    return NextResponse.json({ path: artifactPath, content }, { headers });
  } catch {
    return notFound("Artifact not found. Run the case or oracle solve script first.");
  }
}
