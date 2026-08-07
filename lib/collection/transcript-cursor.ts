import crypto from "node:crypto";
import { PARSER_VERSION } from "../live-cache";
import type { CollectionSourceSpec, TranscriptCursorState } from "../live";

// Keep the fallback stable because Next can evaluate the page and route in
// separate server bundles. Deployments may provide a private process secret.
const CURSOR_SECRET = process.env.OPENEVAL_TRANSCRIPT_CURSOR_SECRET ?? "openeval-local-transcript-cursor-v1";

export interface TranscriptCursorPayload {
  v: 1;
  sourceId: string;
  sessionId: string;
  file: string;
  project: string;
  format: string;
  parserVersion: number;
  descriptorHash: string;
  revision: { size: number; mtimeMs: number; fingerprint: string };
  byteOffset: number;
  state: TranscriptCursorState;
}

export function transcriptDescriptorHash(sourceId: string, spec: CollectionSourceSpec): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    sourceId,
    format: spec.format,
    fields: spec.fields ?? null,
    inferredModel: spec.inferredModel ?? null,
  })).digest("hex");
}

export function encodeTranscriptCursor(payload: TranscriptCursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", CURSOR_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function decodeTranscriptCursor(raw: string): TranscriptCursorPayload | null {
  try {
    const parts = raw.split(".");
    if (parts.length !== 2) return null;
    const [body, signature] = parts;
    if (!body || !signature) return null;
    const expected = crypto.createHmac("sha256", CURSOR_SECRET).update(body).digest("base64url");
    const actualBytes = Buffer.from(signature, "base64url");
    const expectedBytes = Buffer.from(expected, "base64url");
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TranscriptCursorPayload>;
    if (parsed.v !== 1 || typeof parsed.sourceId !== "string" || typeof parsed.sessionId !== "string" || typeof parsed.file !== "string" || typeof parsed.project !== "string" || typeof parsed.format !== "string") return null;
    if (parsed.parserVersion !== PARSER_VERSION || typeof parsed.descriptorHash !== "string") return null;
    if (!parsed.revision || !Number.isFinite(parsed.revision.size) || parsed.revision.size < 0 || !Number.isFinite(parsed.revision.mtimeMs) || parsed.revision.mtimeMs < 0 || typeof parsed.revision.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(parsed.revision.fingerprint)) return null;
    if (!Number.isInteger(parsed.byteOffset) || (parsed.byteOffset ?? -1) < 0 || !parsed.state || !Array.isArray(parsed.state.calls) || parsed.state.calls.length > 512 || !Number.isInteger(parsed.state.recordIndex) || (parsed.state.recordIndex ?? -1) < 0 || !Number.isInteger(parsed.state.semanticTurns) || (parsed.state.semanticTurns ?? -1) < 0) return null;
    if (parsed.state.calls.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !entry[0] || typeof entry[1] !== "object" || entry[1] === null || typeof entry[1].name !== "string" || (entry[1].at !== undefined && !Number.isFinite(entry[1].at)))) return null;
    return parsed as TranscriptCursorPayload;
  } catch {
    return null;
  }
}
