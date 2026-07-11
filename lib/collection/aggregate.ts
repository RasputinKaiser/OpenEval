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
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  totalToolCalls: number;
  avgDataQuality: number;
  lastActivityMs: number | null;
  scanWarnings: string[];
  note?: string;
}

export interface ModelRollup {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  toolCalls: number;
  toolErrors: number;
}

export interface ToolRollup {
  name: string;
  calls: number;
  errors: number;
}

/**
 * Lean projection of a session for list UIs. The full LiveSession (trace
 * graph, tool summaries, usage segments, mode/queue/file activity) stays
 * server-side — shipping it made list pages multi-megabyte and slow to
 * hydrate. Add a field here only when a list actually renders it.
 */
export interface CollectionSessionItem {
  sessionId: string;
  sourceId: string;
  sourceLabel: string;
  displayTitle: string | null;
  lastPromptPreview: string | null;
  project: string;
  model: string | null;
  path?: string;
  archived?: boolean;
  startedAt: number;
  lastEventAt: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  toolErrors: number;
  dataQuality: number;
}

export function toCollectionSessionItem(s: LiveSession, sourceId: string, sourceLabel: string): CollectionSessionItem {
  return {
    sessionId: s.sessionId,
    sourceId,
    sourceLabel,
    displayTitle: s.displayTitle,
    lastPromptPreview: s.lastPromptPreview,
    project: s.project,
    model: s.model,
    path: s.path,
    archived: s.archived,
    startedAt: s.startedAt,
    lastEventAt: s.lastEventAt,
    durationMs: s.durationMs,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    toolCalls: s.toolCalls,
    toolErrors: s.toolErrors,
    dataQuality: s.dataQuality,
  };
}

export interface AllSourcesResult {
  sources: CollectedSourceSummary[];
  unknown: UnknownCandidate[];
  sessions: CollectionSessionItem[];
  presentSources: number;
  totalFiles: number;
  totalParsedSessions: number;
  totalArchivedSessions: number;
  totalCostUsd: number;
  anyEstimatedCost: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  totalToolCalls: number;
  byModel: ModelRollup[];
  byTool: ToolRollup[];
}

/** Merge per-source model rollups into one cross-source list, by cost desc. */
export function mergeModelRollups(lists: ModelRollup[][]): ModelRollup[] {
  const merged = new Map<string, ModelRollup>();
  for (const list of lists) {
    for (const m of list) {
      const cur = merged.get(m.model) ?? { model: m.model, sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, toolCalls: 0, toolErrors: 0 };
      cur.sessions += m.sessions;
      cur.inputTokens += m.inputTokens;
      cur.outputTokens += m.outputTokens;
      cur.cacheReadTokens += m.cacheReadTokens;
      cur.costUsd += m.costUsd;
      cur.toolCalls += m.toolCalls;
      cur.toolErrors += m.toolErrors;
      merged.set(m.model, cur);
    }
  }
  return [...merged.values()].sort((a, b) => b.costUsd - a.costUsd || b.sessions - a.sessions);
}

/**
 * Merge per-source tool tallies into one cross-source list, by calls desc.
 * Sources report only their own top tools, so counts below the head of the
 * list are floors, not exact totals.
 */
export function mergeToolRollups(lists: ToolRollup[][], top = 12): ToolRollup[] {
  const merged = new Map<string, ToolRollup>();
  for (const list of lists) {
    for (const t of list) {
      const cur = merged.get(t.name) ?? { name: t.name, calls: 0, errors: 0 };
      cur.calls += t.calls;
      cur.errors += t.errors;
      merged.set(t.name, cur);
    }
  }
  return [...merged.values()].sort((a, b) => b.calls - a.calls).slice(0, top);
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
  const allSessions: CollectionSessionItem[] = [];
  const modelLists: ModelRollup[][] = [];
  const toolLists: ToolRollup[][] = [];

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
      totalCacheReadTokens: 0,
      totalCacheCreateTokens: 0,
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
      base.totalCacheReadTokens = agg.usageSummary.totalCacheReadTokens;
      base.totalCacheCreateTokens = agg.usageSummary.totalCacheCreateTokens;
      base.totalToolCalls = agg.totalToolCalls;
      modelLists.push(agg.byModel.map((m) => ({
        model: m.model, sessions: m.sessions, inputTokens: m.inputTokens, outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens, costUsd: m.costUsd, toolCalls: m.toolCalls, toolErrors: m.errors,
      })));
      toolLists.push(agg.byTool.map((t) => ({ name: t.name, calls: t.calls, errors: t.errors })));
      base.avgDataQuality = agg.avgDataQuality;
      base.scanWarnings = agg.scanWarnings;
      // Whole-history flag — agg.sessions is display-sliced to 100, so a
      // `.some()` over it would miss estimated sessions past the slice.
      base.costEstimated = agg.sessionsWithInferredCost > 0;
      for (const s of agg.sessions) {
        allSessions.push(toCollectionSessionItem(s, def.id, def.label));
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
    totalCacheReadTokens: summaries.reduce((a, s) => a + s.totalCacheReadTokens, 0),
    totalCacheCreateTokens: summaries.reduce((a, s) => a + s.totalCacheCreateTokens, 0),
    totalToolCalls: summaries.reduce((a, s) => a + s.totalToolCalls, 0),
    byModel: mergeModelRollups(modelLists),
    byTool: mergeToolRollups(toolLists),
  };
}
