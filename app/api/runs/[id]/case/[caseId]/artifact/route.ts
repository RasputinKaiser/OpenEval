import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { getRunCaseByCaseId } from "@/lib/db";
import { resolveWithin } from "@/lib/config";
import { isTerminalCaseStatus } from "@/lib/status";
import { badRequest, internalError, notFound, parseQuery } from "@/lib/api-http";

const querySchema = z.object({
  path: z.string().min(1, "path is required"),
});

/** JSON previews preserve the existing response contract without copying an entire artifact into memory. */
const ARTIFACT_PREVIEW_MAX_BYTES = 512 * 1024;

interface ByteRange {
  start: number;
  end: number;
}

function parseByteRange(value: string, size: number): ByteRange | null {
  if (size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const input = fs.createReadStream(filePath);
  try {
    for await (const chunk of input) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } finally {
    input.destroy();
  }
}

function readPreview(filePath: string, size: number): Buffer {
  const previewSize = Math.min(size, ARTIFACT_PREVIEW_MAX_BYTES);
  if (previewSize === 0) return Buffer.alloc(0);
  const fd = fs.openSync(filePath, "r");
  try {
    const preview = Buffer.allocUnsafe(previewSize);
    const read = fs.readSync(fd, preview, 0, previewSize, 0);
    return preview.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string; caseId: string }> }
) {
  const params = await props.params;
  const { id: runId, caseId } = params;
  const query = parseQuery(req, querySchema);
  if (!query.ok) return query.response;
  const artifactPath = query.data.path;

  let rc;
  try {
    rc = getRunCaseByCaseId(runId, caseId);
  } catch (error) {
    return internalError("Failed to load artifact metadata", error);
  }
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
    const stat = fs.statSync(realArtifact);
    if (!stat.isFile()) return notFound("Artifact is not a regular file");
    const rangeHeader = req.headers.get("range");
    const range = rangeHeader ? parseByteRange(rangeHeader, stat.size) : null;
    const cacheHeaders = isTerminalCaseStatus(rc.status)
      ? { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" }
      : { "Cache-Control": "no-cache" };
    const headers = new Headers({ ...cacheHeaders, "Accept-Ranges": "bytes" });
    if (rangeHeader && !range) {
      headers.set("Content-Range", `bytes */${stat.size}`);
      return new NextResponse(null, { status: 416, headers });
    }
    const sha256 = await hashFile(realArtifact);
    const etag = `"${sha256}"`;
    headers.set("ETag", etag);
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }

    if (range) {
      const stream = fs.createReadStream(realArtifact, { start: range.start, end: range.end });
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Length", String(range.end - range.start + 1));
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
      return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status: 206, headers });
    }

    const preview = readPreview(realArtifact, stat.size);
    return NextResponse.json({
      path: artifactPath,
      content: preview.toString("utf8"),
      bytes: stat.size,
      sha256,
      modifiedAtMs: stat.mtimeMs,
      previewBytes: preview.byteLength,
      contentTruncated: stat.size > ARTIFACT_PREVIEW_MAX_BYTES,
    }, { headers });
  } catch {
    return notFound("Artifact not found. Run the case or oracle solve script first.");
  }
}
