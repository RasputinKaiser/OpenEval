import crypto from "node:crypto";
import { PARSER_VERSION } from "../live-cache";
import type { CollectionSourceSpec, TranscriptCursorState } from "../live";

import { loadCursorKey } from './cursor-key';

let key: Buffer | undefined;
const cursorKey = () => key ??= loadCursorKey();
const CURSOR_AAD = Buffer.from('openeval-transcript-cursor-v2');
const MAX_CURSOR_CHARS = 2_000_000;

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
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cursorKey(), iv);
  cipher.setAAD(CURSOR_AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return ['v2', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decodeTranscriptCursor(raw: string): TranscriptCursorPayload | null {
  try {
    if (raw.length > MAX_CURSOR_CHARS) return null;
    const parts = raw.split('.');
    // Old signed-only links contained paths and used a public fallback key.
    // Retire them explicitly; callers already return a refresh-required response.
    if (parts.length !== 4 || parts[0] !== 'v2' || parts.slice(1).some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const iv = Buffer.from(parts[1], 'base64url'), ciphertext = Buffer.from(parts[2], 'base64url'), tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', cursorKey(), iv);
    decipher.setAAD(CURSOR_AAD); decipher.setAuthTag(tag);
    const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as Partial<TranscriptCursorPayload>;
    if (parsed.v !== 1 || typeof parsed.sourceId !== "string" || typeof parsed.sessionId !== "string" || typeof parsed.file !== "string" || typeof parsed.project !== "string" || typeof parsed.format !== "string") return null;
    if (parsed.parserVersion !== PARSER_VERSION || typeof parsed.descriptorHash !== "string") return null;
    if (!parsed.revision || !Number.isFinite(parsed.revision.size) || parsed.revision.size < 0 || !Number.isFinite(parsed.revision.mtimeMs) || parsed.revision.mtimeMs < 0 || typeof parsed.revision.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(parsed.revision.fingerprint)) return null;
    if (!Number.isInteger(parsed.byteOffset) || (parsed.byteOffset ?? -1) < 0 || !parsed.state || !Array.isArray(parsed.state.calls) || parsed.state.calls.length > 512 || !Number.isInteger(parsed.state.recordIndex) || (parsed.state.recordIndex ?? -1) < 0 || !Number.isInteger(parsed.state.semanticTurns) || (parsed.state.semanticTurns ?? -1) < 0) return null;
    if (parsed.state.calls.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !entry[0] || typeof entry[1] !== "object" || entry[1] === null || typeof entry[1].name !== "string" || (entry[1].at !== undefined && !Number.isFinite(entry[1].at)))) return null;
    if (parsed.state.skipCandidates !== undefined && (!Number.isInteger(parsed.state.skipCandidates) || parsed.state.skipCandidates < 0)) return null;
    return parsed as TranscriptCursorPayload;
  } catch {
    return null;
  }
}
