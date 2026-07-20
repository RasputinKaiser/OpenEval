import type { LiveAggregate, LiveSession } from "../../lib/live";
import { redactNamedUsers, redactSensitiveText } from "../../lib/redaction";

export type FilterMode = "all" | "attention" | "stale" | "missing";
export type SortMode = "recent" | "quality" | "errors";

export const FILTER_MODES: ReadonlyArray<[FilterMode, string]> = [
  ["all", "All"],
  ["attention", "Attention"],
  ["stale", "Stale"],
  ["missing", "Missing"],
];

export const SORT_MODES: ReadonlyArray<[SortMode, string]> = [
  ["recent", "Recent"],
  ["quality", "Quality"],
  ["errors", "Errors"],
];

export const DEFAULT_FILTER: FilterMode = "all";
export const DEFAULT_SORT: SortMode = "recent";

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

export function sessionKey(session: LiveSession): string {
  return session.path ?? `${session.sessionId}\u0000${session.project}`;
}

// Reuse the previous session object (same reference) when its identity marker
// is unchanged so React.memo'd rows skip re-rendering; only genuinely-changed
// sessions get new references. The aggregate wrapper always comes from `next`:
// a full payload means the server's signature already judged the content
// changed, and second-guessing it here with a narrower field list would risk
// silently discarding real updates.
export function mergeAggregate(prev: LiveAggregate | null, next: LiveAggregate): LiveAggregate {
  if (!prev || prev.sessions.length === 0) return next;
  const prevByKey = new Map(prev.sessions.map((session) => [sessionKey(session), session]));
  const sessions = next.sessions.map((session) => {
    const old = prevByKey.get(sessionKey(session));
    if (
      old &&
      old.lastEventAt === session.lastEventAt &&
      old.lineCount === session.lineCount &&
      old.pathBytes === session.pathBytes &&
      old.toolCalls === session.toolCalls &&
      old.toolErrors === session.toolErrors &&
      old.dataQuality === session.dataQuality &&
      old.archived === session.archived
    ) {
      return old;
    }
    return session;
  });
  return { ...next, sessions };
}

/** Filter + sort the session list for display. Pure so the view logic is testable. */
export function selectVisibleSessions(
  sessions: readonly LiveSession[],
  view: LiveViewState,
  now: number = Date.now()
): LiveSession[] {
  const q = view.search.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    if (view.filter === "attention" && !needsAttention(session)) return false;
    if (view.filter === "stale" && !isSessionStale(session, now)) return false;
    if (view.filter === "missing" && !Object.values(session.metricSources).some((source) => source === "missing" || source === "malformed")) return false;
    if (q) {
      const hay = `${session.sessionId} ${session.project} ${session.displayTitle ?? ""} ${session.model ?? ""}`.toLowerCase();
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

export function needsAttention(session: LiveSession): boolean {
  return session.isError || session.toolErrors > 0 || session.hookErrors > 0 || session.dataQuality < 70 || session.malformedLineCount > 0;
}

export function staleThresholdMs(): number {
  return 1000 * 60 * 60 * 12;
}

// Derived from lastEventAt at render time. The server-stamped staleMs freezes
// under the unchanged-sig poll shortcut and reused session references, so the
// client must not read it for staleness decisions.
export function isSessionStale(session: LiveSession, now: number = Date.now()): boolean {
  return now - session.lastEventAt > staleThresholdMs();
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

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

export function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

/** Collection transcript-viewer link for a session, when its transcript file is known. */
export function collectionTranscriptHref(session: LiveSession): string | null {
  if (!session.path) return null;
  return `/collection/session?file=${encodeURIComponent(session.path)}`;
}
