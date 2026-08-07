import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type RawOutputStream = "stdout" | "stderr";

export interface RawOutputReference {
  stream: RawOutputStream;
  path: string;
  bytes: number;
  sha256: string | null;
  revision: number;
  complete: boolean;
  truncated: boolean;
  writeError: string | null;
}

export interface RawOutputCapture {
  version: 1;
  streams: { stdout: RawOutputReference; stderr: RawOutputReference };
  complete: boolean;
  truncated: boolean;
  writeError: string | null;
}

export interface RawOutputPaths { stdoutPath: string; stderrPath: string; }

interface RawOutputWriter {
  readonly reference: RawOutputReference;
  write(chunk: Buffer): boolean;
  onDrain(callback: () => void): void;
  close(): Promise<void>;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function makeReference(stream: RawOutputStream, filePath: string): RawOutputReference {
  return { stream, path: filePath, bytes: 0, sha256: null, revision: 1, complete: false, truncated: false, writeError: null };
}

function createWriter(stream: RawOutputStream, filePath: string): RawOutputWriter {
  const reference = makeReference(stream, filePath);
  const writable = fs.createWriteStream(filePath, { flags: "w" });
  const hash = createHash("sha256");
  let hashValid = true;
  let closed = false;
  const markError = (error: unknown) => {
    if (!reference.writeError) reference.writeError = errorMessage(error);
    reference.complete = false;
    reference.truncated = true;
    hashValid = false;
  };
  writable.on("error", markError);
  return {
    reference,
    write(chunk) {
      if (closed || reference.writeError) return true;
      reference.bytes += chunk.byteLength;
      if (hashValid) {
        try { hash.update(chunk); } catch (error) { markError(error); }
      }
      try { return writable.write(chunk); } catch (error) { markError(error); return true; }
    },
    onDrain(callback) {
      if (closed || reference.writeError) { callback(); return; }
      writable.once("drain", callback);
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        writable.once("error", (error) => { markError(error); finish(); });
        writable.end(finish);
      });
      if (!reference.writeError && hashValid) {
        try { reference.sha256 = hash.digest("hex"); } catch (error) { markError(error); }
      }
      reference.complete = !reference.writeError;
    },
  };
}

function captureFromReferences(stdout: RawOutputReference, stderr: RawOutputReference): RawOutputCapture {
  const writeError = stdout.writeError || stderr.writeError;
  return { version: 1, streams: { stdout, stderr }, complete: stdout.complete && stderr.complete, truncated: stdout.truncated || stderr.truncated, writeError };
}

export class RawOutputCaptureWriter {
  private readonly writers: Record<RawOutputStream, RawOutputWriter>;
  constructor(paths: RawOutputPaths) {
    this.writers = { stdout: createWriter("stdout", paths.stdoutPath), stderr: createWriter("stderr", paths.stderrPath) };
  }
  write(stream: RawOutputStream, chunk: Buffer): boolean { return this.writers[stream].write(chunk); }
  onDrain(stream: RawOutputStream, callback: () => void): void { this.writers[stream].onDrain(callback); }
  async close(): Promise<RawOutputCapture> {
    await Promise.all(Object.values(this.writers).map((writer) => writer.close()));
    return captureFromReferences(this.writers.stdout.reference, this.writers.stderr.reference);
  }
}

async function hashFile(filePath: string, stream: RawOutputStream): Promise<RawOutputReference> {
  const reference = makeReference(stream, filePath);
  try {
    const stat = await fsp.stat(filePath);
    reference.bytes = stat.size;
    await new Promise<void>((resolve, reject) => {
      const hash = createHash("sha256");
      const input = fs.createReadStream(filePath);
      input.on("data", (chunk: string | Buffer) => hash.update(chunk));
      input.on("error", reject);
      input.on("end", () => { reference.sha256 = hash.digest("hex"); resolve(); });
    });
    reference.complete = true;
  } catch (error) {
    reference.writeError = errorMessage(error);
    reference.truncated = true;
  }
  return reference;
}

export async function inspectRawOutputFiles(paths: RawOutputPaths): Promise<RawOutputCapture> {
  const [stdout, stderr] = await Promise.all([hashFile(paths.stdoutPath, "stdout"), hashFile(paths.stderrPath, "stderr")]);
  return captureFromReferences(stdout, stderr);
}

export async function ensureRawOutputPaths(paths: RawOutputPaths): Promise<void> {
  await Promise.all([fsp.mkdir(path.dirname(paths.stdoutPath), { recursive: true }), fsp.mkdir(path.dirname(paths.stderrPath), { recursive: true })]);
}
