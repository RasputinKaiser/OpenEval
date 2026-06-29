import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRunCaseByCaseId } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; caseId: string } }
) {
  const { id: runId, caseId } = params;
  const artifactPath = req.nextUrl.searchParams.get("path");

  if (!artifactPath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Sanitize: only allow filenames, no directory traversal
  const safeName = path.basename(artifactPath);
  if (safeName !== artifactPath) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const rc = getRunCaseByCaseId(runId, caseId);
  if (!rc) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const fullPath = path.join(rc.workdir_path, safeName);
  if (!fullPath.startsWith(rc.workdir_path)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const content = fs.readFileSync(fullPath, "utf8");
    return NextResponse.json({ path: safeName, content });
  } catch {
    return NextResponse.json(
      { error: "Artifact not found. Run the case or oracle solve script first." },
      { status: 404 }
    );
  }
}
