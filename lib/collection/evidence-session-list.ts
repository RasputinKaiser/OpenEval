import { canonicalModel } from "./analysis";
import type { CollectedSession } from "./aggregate";

export const EVIDENCE_SESSION_TITLE_LIMIT = 160;
export const EVIDENCE_SESSION_DEFAULT_LIMIT = 40;
export const EVIDENCE_SESSION_MAX_LIMIT = 100;

/** Metadata allowed in the searchable evidence-session selector. */
export interface EvidenceSessionListItem {
  sourceId: string;
  sessionId: string;
  title: string;
  model: string;
  startedAt: number;
  archived: boolean;
  isSubagent: boolean;
}

export interface EvidenceSessionListPage {
  sessions: EvidenceSessionListItem[];
  totalMatched: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  generation: number;
  query?: string;
}

function boundedText(value: string, limit = EVIDENCE_SESSION_TITLE_LIMIT): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function sessionTitle(session: CollectedSession): string {
  return boundedText(session.displayTitle || session.lastPromptPreview || session.sessionId || "Untitled session");
}

/** Search only bounded session metadata; this never reads transcript text. */
export function filterEvidenceSessionMetadata(
  sessions: readonly CollectedSession[],
  query = "",
): CollectedSession[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sessions];
  return sessions.filter((session) => [sessionTitle(session), session.sessionId, canonicalModel(session.model)]
    .some((value) => value.toLowerCase().includes(needle)));
}

export function toEvidenceSessionListItem(session: CollectedSession): EvidenceSessionListItem {
  return {
    sourceId: session.sourceId,
    sessionId: session.sessionId,
    title: sessionTitle(session),
    model: canonicalModel(session.model),
    startedAt: session.startedAt,
    archived: Boolean(session.archived),
    isSubagent: Boolean(session.isSubagent || session.parentSessionId),
  };
}

export function buildEvidenceSessionListPage(
  matched: readonly CollectedSession[],
  meta: { generation: number; query?: string },
  page: { offset?: number; limit?: number } = {},
): EvidenceSessionListPage {
  const rawOffset = page.offset ?? 0;
  const rawLimit = page.limit ?? EVIDENCE_SESSION_DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const limit = Number.isFinite(rawLimit) ? Math.min(EVIDENCE_SESSION_MAX_LIMIT, Math.max(1, Math.floor(rawLimit))) : EVIDENCE_SESSION_DEFAULT_LIMIT;
  const ordered = [...matched].sort((a, b) => b.startedAt - a.startedAt || a.sourceId.localeCompare(b.sourceId) || a.sessionId.localeCompare(b.sessionId));
  const sessions = ordered.slice(offset, offset + limit).map(toEvidenceSessionListItem);
  return {
    sessions,
    totalMatched: ordered.length,
    offset,
    limit,
    nextOffset: offset + limit < ordered.length ? offset + limit : null,
    generation: meta.generation,
    ...(meta.query ? { query: meta.query } : {}),
  };
}
