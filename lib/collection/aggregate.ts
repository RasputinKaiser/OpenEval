import crypto from "node:crypto";
import { collectSourceSessions, scanSourceSessions, type LiveAggregate, type LiveSession } from "../live";
import { allCollectionSources, defToSpec, type CollectionSourceDef } from "./sources";
import { discoverKnownSources, discoverUnknownCandidates, type DiscoveredSource, type UnknownCandidate } from "./discover";
import { displayModelId, PRICING_LIST_DATE, PRICING_SOURCE } from "../pricing";

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
  pricedSessions: number;
  measuredCostSessions: number;
  listedRateSessions: number;
  familyRateSessions: number;
  fallbackRateSessions: number;
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
  pricedSessions: number;
  measuredCostSessions: number;
  allocatedCostSessions: number;
  listedRateSessions: number;
  familyRateSessions: number;
  fallbackRateSessions: number;
  inferredModelSessions: number;
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
    model: displayModelId(s.model),
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
  /** Stable reference time used by server and client for deterministic relative labels. */
  generatedAtMs: number;
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
  totalPricedSessions: number;
  totalMeasuredCostSessions: number;
  totalListedRateSessions: number;
  totalFamilyRateSessions: number;
  totalFallbackRateSessions: number;
  pricingListDate: string;
  pricingSource: string;
  byModel: ModelRollup[];
  byTool: ToolRollup[];
}

/** Merge per-source model rollups into one cross-source list, by cost desc. */
export function mergeModelRollups(lists: ModelRollup[][]): ModelRollup[] {
  const merged = new Map<string, ModelRollup>();
  for (const list of lists) {
    for (const m of list) {
      const cur = merged.get(m.model) ?? {
        model: m.model, sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0,
        toolCalls: 0, toolErrors: 0, pricedSessions: 0, measuredCostSessions: 0, allocatedCostSessions: 0, listedRateSessions: 0,
        familyRateSessions: 0, fallbackRateSessions: 0, inferredModelSessions: 0,
      };
      cur.sessions += m.sessions;
      cur.inputTokens += m.inputTokens;
      cur.outputTokens += m.outputTokens;
      cur.cacheReadTokens += m.cacheReadTokens;
      cur.costUsd += m.costUsd;
      cur.toolCalls += m.toolCalls;
      cur.toolErrors += m.toolErrors;
      cur.pricedSessions += m.pricedSessions;
      cur.measuredCostSessions += m.measuredCostSessions;
      cur.allocatedCostSessions += m.allocatedCostSessions;
      cur.listedRateSessions += m.listedRateSessions;
      cur.familyRateSessions += m.familyRateSessions;
      cur.fallbackRateSessions += m.fallbackRateSessions;
      cur.inferredModelSessions += m.inferredModelSessions;
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

/** Sessions retained in the memoized result; per-call `limit` slices down from this. */
const SESSION_ITEM_CAP = 10_000;

function computeAllSources(discovered: DiscoveredSource[]): AllSourcesResult {
  const byId = new Map(discovered.map((d) => [d.id, d]));

  const summaries: CollectedSourceSummary[] = [];
  const allSessions: CollectionSessionItem[] = [];
  const modelLists: ModelRollup[][] = [];
  const toolLists: ToolRollup[][] = [];

  for (const def of hooks.sources()) {
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
      pricedSessions: 0,
      measuredCostSessions: 0,
      listedRateSessions: 0,
      familyRateSessions: 0,
      fallbackRateSessions: 0,
      avgDataQuality: 0,
      lastActivityMs: disc?.lastActivityMs ?? null,
      scanWarnings: [],
      note: def.note,
    };

    if (def.parseable && base.status === "present") {
      // Reuse discovery's walk (files + warnings) instead of re-walking the
      // whole source tree for the scan.
      const agg: LiveAggregate = scanSourceSessions(defToSpec(def), FULL_HISTORY, { includeArchived: true, preCollected: disc?.collected });
      base.archivedSessions = agg.archivedSessions;
      base.parsedSessions = agg.totalSessions;
      base.totalCostUsd = agg.totalCostUsd;
      base.totalInputTokens = agg.totalInputTokens;
      base.totalOutputTokens = agg.totalOutputTokens;
      base.totalCacheReadTokens = agg.usageSummary.totalCacheReadTokens;
      base.totalCacheCreateTokens = agg.usageSummary.totalCacheCreateTokens;
      base.totalToolCalls = agg.totalToolCalls;
      base.pricedSessions = agg.usageSummary.sessionsWithPricedUsage;
      base.measuredCostSessions = agg.usageSummary.sessionsWithMeasuredCost;
      base.listedRateSessions = agg.usageSummary.sessionsWithListedRate;
      base.familyRateSessions = agg.usageSummary.sessionsWithFamilyRate;
      base.fallbackRateSessions = agg.usageSummary.sessionsWithFallbackRate;
      modelLists.push(agg.byModel.map((m) => ({
        model: m.model, sessions: m.sessions, inputTokens: m.inputTokens, outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens, costUsd: m.costUsd, toolCalls: m.toolCalls, toolErrors: m.errors,
        pricedSessions: m.pricedSessions, measuredCostSessions: m.measuredCostSessions, allocatedCostSessions: m.allocatedCostSessions,
        listedRateSessions: m.listedRateSessions, familyRateSessions: m.familyRateSessions,
        fallbackRateSessions: m.fallbackRateSessions, inferredModelSessions: m.inferredModelSessions,
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
  const sessions = allSessions.slice(0, SESSION_ITEM_CAP);

  // Unknown candidates: exclude every known root from the heuristic scan.
  const knownRoots = discovered.flatMap((d) => d.roots);
  const unknown = hooks.unknown(knownRoots);

  return {
    generatedAtMs: Date.now(),
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
    totalPricedSessions: summaries.reduce((a, s) => a + s.pricedSessions, 0),
    totalMeasuredCostSessions: summaries.reduce((a, s) => a + s.measuredCostSessions, 0),
    totalListedRateSessions: summaries.reduce((a, s) => a + s.listedRateSessions, 0),
    totalFamilyRateSessions: summaries.reduce((a, s) => a + s.familyRateSessions, 0),
    totalFallbackRateSessions: summaries.reduce((a, s) => a + s.fallbackRateSessions, 0),
    pricingListDate: PRICING_LIST_DATE,
    pricingSource: PRICING_SOURCE,
    byModel: mergeModelRollups(modelLists),
    byTool: mergeToolRollups(toolLists),
  };
}

/** A parsed session tagged with the source it came from. */
export type CollectedSession = LiveSession & { sourceId: string; sourceLabel: string };

interface CollectionSnapshot {
  fingerprint: string;
  result: AllSourcesResult;
  /** Full history of every parseable source (archived included), source-tagged. */
  sessions: CollectedSession[];
}

/**
 * Concurrent requests within this window share the last fingerprint check
 * instead of re-statting every session file per request. `fresh: true`
 * bypasses it (revalidate NOW) — it does not force a recompute.
 */
const FINGERPRINT_TTL_MS = 3_000;

/**
 * Test seams (the `_setCacheDbForTest` pattern): the real source registry and
 * discovery walk both point at fixed home-dir roots, so memo behavior is only
 * testable by injecting temp-dir equivalents.
 */
interface CollectionHooks {
  discover: () => DiscoveredSource[];
  sources: () => CollectionSourceDef[];
  unknown: (knownRoots: string[]) => UnknownCandidate[];
  /** Test-only override; production always uses FINGERPRINT_TTL_MS. */
  fingerprintTtlMs?: number;
}

const DEFAULT_HOOKS: CollectionHooks = {
  discover: discoverKnownSources,
  sources: allCollectionSources,
  unknown: discoverUnknownCandidates,
};

let hooks: CollectionHooks = DEFAULT_HOOKS;

export function _setCollectionHooksForTest(overrides: Partial<CollectionHooks> | null): void {
  hooks = overrides ? { ...DEFAULT_HOOKS, ...overrides } : DEFAULT_HOOKS;
  snapshot = null;
  lastValidatedAt = 0;
}

/**
 * Corpus identity from the discovery walk (which already stats every session
 * file): per-source status plus every file's (path, mtime, size). Any file
 * added, removed, renamed, touched, or resized changes the fingerprint; an
 * unchanged fingerprint proves the memoized parse still matches the disk.
 */
export function fingerprintDiscovery(discovered: DiscoveredSource[]): string {
  const h = crypto.createHash("sha256");
  for (const d of discovered) {
    h.update(`${d.id} ${d.status} ${d.sessionCount} ${d.lastActivityMs ?? -1}`);
    if (d.collected) {
      const files = [...d.collected.files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
      for (const f of files) h.update(`${f.file} ${f.mtime} ${f.size}`);
    }
  }
  return h.digest("hex");
}

/**
 * Full discovery + parse is 0.4–2s+ and runs synchronously inside server-
 * component renders — and one render used to run it up to three times
 * (sources scan, rollup, timeline). Instead of a blind 5s TTL, the memo is
 * keyed by the corpus fingerprint: each request re-runs only the cheap
 * discovery stat pass and serves the memoized parse while the fingerprint
 * matches. Memoized data is never served across a fingerprint change.
 */
let snapshot: CollectionSnapshot | null = null;
let lastValidatedAt = 0;

function getSnapshot(opts: { fresh?: boolean } = {}): CollectionSnapshot {
  const now = Date.now();
  const ttlMs = hooks.fingerprintTtlMs ?? FINGERPRINT_TTL_MS;
  if (!opts.fresh && snapshot && now - lastValidatedAt < ttlMs) return snapshot;
  const discovered = hooks.discover();
  const fingerprint = fingerprintDiscovery(discovered);
  if (!snapshot || snapshot.fingerprint !== fingerprint) {
    snapshot = computeSnapshot(discovered, fingerprint);
  } else if (opts.fresh) {
    // Explicit rescan with an unchanged corpus: the parse memo stands, but the
    // unknown-candidate walk covers dirs OUTSIDE the fingerprint — re-run it so
    // a newly installed agent CLI still surfaces without a known-source change.
    const unknown = hooks.unknown(discovered.flatMap((d) => d.roots));
    snapshot = { ...snapshot, result: { ...snapshot.result, unknown } };
  }
  lastValidatedAt = now;
  return snapshot;
}

function computeSnapshot(discovered: DiscoveredSource[], fingerprint: string): CollectionSnapshot {
  // Aggregate first: scanSourceSessions primes the per-file session cache, so
  // the full-history collection below re-reads no transcript bytes. The
  // collection deliberately covers every parseable def — not just "present"
  // ones — because archived sessions of a since-deleted root still live in
  // the parse cache and must keep feeding rollup/timeline (as they did when
  // those callers collected for themselves).
  const result = computeAllSources(discovered);
  const sessions: CollectedSession[] = [];
  for (const def of hooks.sources()) {
    if (!def.parseable) continue;
    for (const s of collectSourceSessions(defToSpec(def), FULL_HISTORY, { includeArchived: true })) {
      sessions.push({ ...s, sourceId: def.id, sourceLabel: def.label });
    }
  }
  return { fingerprint, result, sessions };
}

function withLimit(result: AllSourcesResult, limit: number): AllSourcesResult {
  // Restamp the reference time on every serve: the memo can outlive the old
  // 5s TTL by minutes, and relative "x ago" labels must not freeze with it.
  return { ...result, generatedAtMs: Date.now(), sessions: result.sessions.slice(0, limit) };
}

export function scanAllSources(limit = 200, opts: { fresh?: boolean } = {}): AllSourcesResult {
  return withLimit(getSnapshot(opts).result, limit);
}

/**
 * The shared full-history session collection (archived included), parsed at
 * most once per corpus fingerprint. Collection/home/timeline callers pass
 * this to `buildRollup` / `buildTimeline` so one request never parses the
 * session history more than once.
 */
export function collectAllSessions(opts: { fresh?: boolean } = {}): CollectedSession[] {
  // Copy the array (not the sessions): an in-place sort/splice by a caller
  // must never reorder the memoized snapshot served to other requests.
  return [...getSnapshot(opts).sessions];
}
