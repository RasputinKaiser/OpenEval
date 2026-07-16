import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { getRun } from "@/lib/db";
import { buildRunReport, writeRunBundle } from "@/lib/report";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const redact = url.searchParams.get("redact") === "1";
  if (url.searchParams.get("bundle") === "1") {
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
}
