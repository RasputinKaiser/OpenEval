import fs from "node:fs/promises";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRun } from "@/lib/db";
import { buildRunReport, writeRunBundle } from "@/lib/report";
import { internalError, notFound, parseQuery, queryFlag } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const querySchema = z.object({ redact: queryFlag, bundle: queryFlag });

function streamTempFile(filePath: string, tempRoot: string): ReadableStream<Uint8Array> {
  const input = nodeFs.createReadStream(filePath);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  };
  input.once("close", cleanup);
  input.once("error", cleanup);
  return Readable.toWeb(input) as unknown as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const query = parseQuery(request, querySchema);
  if (!query.ok) return query.response;
  const { redact, bundle } = query.data;
  let run;
  try {
    run = getRun(params.id);
  } catch (error) {
    return internalError("Failed to load run for report", error);
  }
  if (!run) {
    return notFound("Run not found", { detail: `No run with id "${params.id}".` });
  }
  try {
    if (bundle) {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openeval-report-api-"));
      const bundleName = `openeval-run-${params.id}`;
      const bundleDir = path.join(tempRoot, bundleName);
      const archive = path.join(tempRoot, `${bundleName}.tar.gz`);
      let handedOff = false;
      try {
        await writeRunBundle(params.id, bundleDir, { redact });
        await execFileAsync("tar", ["-czf", archive, "-C", tempRoot, bundleName]);
        const stat = await fs.stat(archive);
        const response = new NextResponse(streamTempFile(archive, tempRoot), {
          headers: {
            "Content-Type": "application/gzip",
            "Content-Disposition": `attachment; filename="${bundleName}.tar.gz"`,
            "Content-Length": String(stat.size),
          },
        });
        handedOff = true;
        return response;
      } finally {
        if (!handedOff) await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openeval-report-api-"));
    const reportPath = path.join(tempRoot, `openeval-run-${params.id}.md`);
    let handedOff = false;
    try {
      const markdown = await buildRunReport(params.id, { redact });
      // Spool before handing the response to the runtime so the delivery path
      // is a bounded file stream rather than another in-memory body copy.
      await fs.writeFile(reportPath, markdown, "utf8");
      const stat = await fs.stat(reportPath);
      const response = new NextResponse(streamTempFile(reportPath, tempRoot), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="openeval-run-${params.id}.md"`,
          "Content-Length": String(stat.size),
        },
      });
      handedOff = true;
      return response;
    } finally {
      if (!handedOff) await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    return internalError("Failed to build run report", error);
  }
}
