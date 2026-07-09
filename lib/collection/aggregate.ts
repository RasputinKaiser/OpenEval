import { scanSourceSessions, type LiveAggregate, type LiveSession } from "../live";
import { allCollectionSources, defToSpec } from "./sources";
import { discoverKnownSources, discoverUnknownCandidates, type UnknownCandidate } from "./discover";

export interface CollectedSourceSummary {
  id: string;
  label: string;
  format: string;
  parseable: boolean;
  status: "present" | "empty" | "absent";
  filesFound: number; // sessions/files discovered on disk
  parsedSessions: number; // sessions actually parsed into metrics (parseable only)
  archivedSessions: number; // sessions whose files were pruned; kept from the parse archive
  totalCostUsd: number;
  costEstimated: boolean; // true when cost was inferred from tokens, not recorded by the harness
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  avgDataQuality: number;
  lastActivityMs: number | null;
  scanWarnings: string[];
  note?: string;
}

export interface AllSourcesResult {
  sources: CollectedSourceSummary[];
  unknown: UnknownCandidate[];
  sessions: Array<LiveSession & { sourceId: string; sourceLabel: string }>;
  presentSources: number;
  totalFiles: number;
  totalParsedSessions: number;
  totalArchivedSessions: number;
  totalCostUsd: number;
  anyEstimatedCost: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
}

/**
 * Collect across EVERY known source (any harness), merging on-disk discovery
 * with the actual parsed scan. Detect-only sources contribute presence + file
 * counts but no metrics; parseable sources contribute real sessions. Sessions
 * are tagged with their source and globally sorted by recency.
 *
 * Totals are computed over the FULL history of every source (the persistent
 * parse cache makes this cheap after the first scan); `limit` only caps the
 * recent-sessions table returned for display.
 */
const FULL_HISTORY = 100_000;

export function scanAllSources(limit = 200): AllSourcesResult {
  const discovered = discoverKnownSources();
  const byId = new Map(discovered.map((d) => [d.id, d]));

  const summaries: CollectedSourceSummary[] = [];
  const allSessions: Array<LiveSession & { sourceId: string; sourceLabel: string }> = [];

  for (const def of allCollectionSources()) {
    const disc = byId.get(def.id);
    const base: CollectedSourceSummary = {
      id: def.id,
      label: def.label,
      format: def.format,
      parseable: def.parseable,
      status: disc?.status ?? "absent",
      filesFound: disc?.sessionCount ?? 0,
      parsedSessions: 0,
      archivedSessions: 0,
      totalCostUsd: 0,
      costEstimated: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalToolCalls: 0,
      avgDataQuality: 0,
      lastActivityMs: disc?.lastActivityMs ?? null,
      scanWarnings: [],
      note: def.note,
    };

    if (def.parseable && base.status === "present") {
      const agg: LiveAggregate = scanSourceSessions(defToSpec(def), FULL_HISTORY, { includeArchived: true });
      base.archivedSessions = agg.archivedSessions;
      base.parsedSessions = agg.totalSessions;
      base.totalCostUsd = agg.totalCostUsd;
      base.totalInputTokens = agg.totalInputTokens;
      base.totalOutputTokens = agg.totalOutputTokens;
      base.totalToolCalls = agg.totalToolCalls;
      base.avgDataQuality = agg.avgDataQuality;
      base.scanWarnings = agg.scanWarnings;
      // Whole-history flag — agg.sessions is display-sliced to 100, so a
      // `.some()` over it would miss estimated sessions past the slice.
      base.costEstimated = agg.sessionsWithInferredCost > 0;
      for (const s of agg.sessions) {
        allSessions.push({ ...s, sourceId: def.id, sourceLabel: def.label });
      }
    }
    summaries.push(base);
  }

  allSessions.sort((a, b) => b.lastEventAt - a.lastEventAt);
  const sessions = allSessions.slice(0, limit);

  // Unknown candidates: exclude every known root from the heuristic scan.
  const knownRoots = discovered.flatMap((d) => d.roots);
  const unknown = discoverUnknownCandidates(knownRoots);

  return {
    sources: summaries.sort((a, b) => b.filesFound - a.filesFound || a.label.localeCompare(b.label)),
    unknown,
    sessions,
    presentSources: summaries.filter((s) => s.status === "present").length,
    totalFiles: summaries.reduce((a, s) => a + s.filesFound, 0),
    totalParsedSessions: summaries.reduce((a, s) => a + s.parsedSessions, 0),
    totalArchivedSessions: summaries.reduce((a, s) => a + s.archivedSessions, 0),
    totalCostUsd: summaries.reduce((a, s) => a + s.totalCostUsd, 0),
    anyEstimatedCost: summaries.some((s) => s.costEstimated),
    totalInputTokens: summaries.reduce((a, s) => a + s.totalInputTokens, 0),
    totalOutputTokens: summaries.reduce((a, s) => a + s.totalOutputTokens, 0),
    totalToolCalls: summaries.reduce((a, s) => a + s.totalToolCalls, 0),
  };
}
