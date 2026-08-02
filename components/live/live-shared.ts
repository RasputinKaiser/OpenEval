import type { LiveAggregate, LiveAggregateList, LiveSessionListItem, LiveTranscriptTurn } from "../../lib/live";
import { classifyParseWarning } from "../../lib/live/warning-taxonomy";
import { redactNamedUsers, redactSensitiveText } from "../../lib/redaction";
import { fmtDuration, fmtNum, fmtRel, fmtUsd } from "@/lib/format";

export type FilterMode = "all" | "attention" | "stale" | "missing";
export type SortMode = "recent" | "quality" | "errors";

export const FILTER_MODES: ReadonlyArray<[FilterMode, string]> = [
  ["all", "All"],
  ["attention", "Attention"],
  ["stale", "Inactive >12h"],
  ["missing", "Missing"],
];

export const SORT_MODES: ReadonlyArray<[SortMode, string]> = [
  ["recent", "Recent"],
  ["quality", "Quality"],
  ["errors", "Errors"],
];

export const DEFAULT_FILTER: FilterMode = "all";
export const DEFAULT_SORT: SortMode = "recent";

/** The parser keeps reasoning as an assistant-role turn; classify it by its semantic tag. */
export function isAgentReasoningTurn(turn: Pick<LiveTranscriptTurn, "type" | "subtype" | "label">): boolean {
  return [turn.type, turn.subtype, turn.label].some((value) => {
    const tag = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
    return tag === "reasoning" || tag === "agent_reasoning" || tag === "thinking" || tag === "agent_thinking" || tag.endsWith("_reasoning");
  });
}

export interface LiveViewState {
  filter: FilterMode;
  sort: SortMode;
  search: string;
}

function isFilterMode(value: string | null): value is FilterMode {
  return FILTER_MODES.some(([mode]) => mode === value);
}

function isSortMode(value: string | null): value is SortMode {
  return SORT_MODES.some(([mode]) => mode === value);
}

/** Read filter/sort/search view state from URL params; unknown values fall back to defaults. */
export function parseLiveViewState(params: URLSearchParams): LiveViewState {
  const filter = params.get("filter");
  const sort = params.get("sort");
  return {
    filter: isFilterMode(filter) ? filter : DEFAULT_FILTER,
    sort: isSortMode(sort) ? sort : DEFAULT_SORT,
    search: params.get("q") ?? "",
  };
}

/** Write view state onto URL params in place; default values are omitted so shared URLs stay clean. */
export function applyLiveViewState(params: URLSearchParams, state: LiveViewState): void {
  if (state.filter === DEFAULT_FILTER) params.delete("filter");
  else params.set("filter", state.filter);
  if (state.sort === DEFAULT_SORT) params.delete("sort");
  else params.set("sort", state.sort);
  const q = state.search.trim();
  if (!q) params.delete("q");
  else params.set("q", q);
}

export function sessionKey(session: LiveSessionListItem): string {
  return session.path ?? `${session.sessionId}\u0000${session.project}`;
}

// Reuse the previous session object only when the complete public list
// projection is unchanged. Full payloads are uncommon (the server returns a
// compact `unchanged` response on a signature hit), so this bounded deep
// comparison is preferable to a hand-maintained subset that can silently
// freeze new provenance, incident, title, or trace fields.
export function mergeAggregate<T extends LiveAggregate | LiveAggregateList>(prev: T | null, next: T): T {
  if (!prev || prev.sessions.length === 0) return next;
  const prevByKey = new Map(prev.sessions.map((session) => [sessionKey(session), session]));
  const sessions = next.sessions.map((session) => {
    const old = prevByKey.get(sessionKey(session));
    if (old && JSON.stringify(old) === JSON.stringify(session)) {
      return old;
    }
    return session;
  });
  return { ...next, sessions } as T;
}

/** Filter + sort the session list for display. Pure so the view logic is testable. */
export function selectVisibleSessions(
  sessions: readonly LiveSessionListItem[],
  view: LiveViewState,
  now: number = Date.now()
): LiveSessionListItem[] {
  const q = view.search.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    if (view.filter === "attention" && !needsAttention(session)) return false;
    if (view.filter === "stale" && !isSessionStale(session, now)) return false;
    if (view.filter === "missing" && !Object.values(session.metricSources).some((source) => source === "missing" || source === "malformed")) return false;
    if (q) {
      const incidentTerms = [
        session.toolErrors > 0 ? "tool error errors incident" : "",
        session.hookErrors > 0 ? "hook error errors incident" : "",
        session.malformedLineCount > 0 ? "malformed parse incident" : "",
        session.isSubagent ? "child agent subagent" : "",
      ];
      const provenanceTerms = Object.entries(session.metricSources)
        .flatMap(([metric, source]) => [metric, source, `${metric} ${source}`]);
      const hay = [
        session.sessionId,
        session.project,
        session.displayTitle ?? "",
        session.model ?? "",
        session.agentLabel ?? "",
        session.parentSessionId ?? "",
        session.modeSummary.gitBranch ?? "",
        ...session.parseWarnings,
        ...incidentTerms,
        ...provenanceTerms,
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return [...filtered].sort((a, b) => {
    if (view.sort === "quality") return a.dataQuality - b.dataQuality || b.lastEventAt - a.lastEventAt;
    if (view.sort === "errors") return b.toolErrors - a.toolErrors || b.hookErrors - a.hookErrors || b.lastEventAt - a.lastEventAt;
    return b.lastEventAt - a.lastEventAt;
  });
}

export function displayText(value: unknown, redact: boolean, users: ReadonlySet<string>): string {
  return redact ? redactNamedUsers(redactSensitiveText(value), users) : String(value ?? "");
}

export function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-5)}`;
}

export function needsAttention(session: LiveSessionListItem): boolean {
  return session.isError || session.toolErrors > 0 || session.hookErrors > 0 || session.dataQuality < 70 || session.malformedLineCount > 0;
}

export function staleThresholdMs(): number {
  return 1000 * 60 * 60 * 12;
}

// Derived from lastEventAt at render time. The server-stamped staleMs freezes
// under the unchanged-sig poll shortcut and reused session references, so the
// client must not read it for staleness decisions.
export function isSessionStale(session: LiveSessionListItem, now: number = Date.now()): boolean {
  return now - session.lastEventAt > staleThresholdMs();
}

/**
 * Keep the session table cheap even when a source has thousands of traces.
 * The caller owns the current window size; slicing is deterministic and does
 * not depend on fragile scroll-position math.
 */
export const SESSION_WINDOW_SIZE = 25;

export function windowSessions<T>(sessions: readonly T[], visibleCount: number = SESSION_WINDOW_SIZE): T[] {
  return sessions.slice(0, Math.max(0, visibleCount));
}

/** Next progressive window size used by the session table's "show more" UI. */
export function nextSessionWindowSize(current: number, total: number): number {
  return Math.min(Math.max(SESSION_WINDOW_SIZE, current) + SESSION_WINDOW_SIZE, total);
}

/** Render numeric zero when evidence exists; reserve "missing" for no evidence. */
export function formatAvailableMetric(
  value: number,
  evidenceCount: number,
  formatter: (metric: number) => string,
): string {
  return evidenceCount > 0 ? formatter(value) : "missing";
}

const WARNING_PRIORITY: Record<ReturnType<typeof classifyParseWarning>, number> = {
  runtimeErrors: 0,
  malformedInput: 1,
  incompleteTrace: 2,
  mixedModels: 3,
  missingEvidence: 4,
  other: 5,
  inferredEvidence: 6,
  metadata: 7,
};

/** Put actionable parser incidents before low-severity provenance notes. */
export function prioritizeSessionWarnings(warnings: readonly string[]): string[] {
  return warnings
    .map((warning, index) => ({ warning, index, priority: WARNING_PRIORITY[classifyParseWarning(warning)] }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ warning }) => warning);
}

/**
 * Summarize adjacent usage buckets into a bounded timeline. Each output point
 * represents a contiguous range, keeps the final cumulative snapshot, and
 * sums deltas so totals remain honest while the drawer mounts a small number
 * of cards even for very long traces.
 */
export const DRAWER_USAGE_POINT_LIMIT = 120;

export function decimateUsageSegments<T extends {
  atMs: number;
  cumulativeInput: number;
  cumulativeOutput: number;
  deltaInput: number;
  deltaOutput: number;
  outTokPerSec: number;
}>(segments: readonly T[], maxPoints: number = DRAWER_USAGE_POINT_LIMIT): T[] {
  if (segments.length <= maxPoints || maxPoints < 2) return [...segments];
  const limit = Math.max(2, Math.floor(maxPoints));
  const out: T[] = [];
  for (let bucket = 0; bucket < limit; bucket++) {
    const start = Math.floor(bucket * segments.length / limit);
    const end = Math.max(start, Math.floor((bucket + 1) * segments.length / limit) - 1);
    const last = segments[end];
    let deltaInput = 0;
    let deltaOutput = 0;
    for (let index = start; index <= end; index++) {
      deltaInput += segments[index].deltaInput;
      deltaOutput += segments[index].deltaOutput;
    }
    out.push({ ...last, deltaInput, deltaOutput });
  }
  return out;
}

export function qualityTone(value: number): "ok" | "warn" | "err" {
  if (value >= 80) return "ok";
  if (value >= 55) return "warn";
  return "err";
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

// Keep the old Live names as compatibility aliases while using the shared
// dashboard formatters for human-scale numbers, durations, and currency.
export const fmt = fmtNum;
export { fmtDuration, fmtNum, fmtRel, fmtUsd };

export function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

export const fmtMs = fmtDuration;

/** Collection transcript-viewer link for a session, when its transcript file is known. */
export function collectionTranscriptHref(session: LiveSessionListItem): string | null {
  if (!session.path) return null;
  return `/collection/session?file=${encodeURIComponent(session.path)}`;
}
