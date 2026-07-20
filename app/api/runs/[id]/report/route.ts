import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRun } from "@/lib/db";
import { buildRunReport, writeRunBundle } from "@/lib/report";
import { internalError, notFound, parseQuery, queryFlag } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const querySchema = z.object({ redact: queryFlag, bundle: queryFlag });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const query = parseQuery(request, querySchema);
  if (!query.ok) return query.response;
  const { redact, bundle } = query.data;
  const run = getRun(params.id);
  if (!run) {
    return notFound("Run not found", { detail: `No run with id "${params.id}".` });
  }
  try {
    if (bundle) {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openeval-report-api-"));
      const bundleName = `openeval-run-${params.id}`;
      const bundleDir = path.join(tempRoot, bundleName);
      const archive = path.join(tempRoot, `${bundleName}.tar.gz`);
      try {
        await writeRunBundle(params.id, bundleDir, { redact });
        await execFileAsync("tar", ["-czf", archive, "-C", tempRoot, bundleName]);
        const payload = await fs.readFile(archive);
        return new NextResponse(new Uint8Array(payload), {
          headers: {
            "Content-Type": "application/gzip",
            "Content-Disposition": `attachment; filename="${bundleName}.tar.gz"`,
          },
        });
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
    const markdown = await buildRunReport(params.id, { redact });
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="openeval-run-${params.id}.md"`,
      },
    });
  } catch (error) {
    return internalError("Failed to build run report", error);
  }
}
