import { collectSourceSessions, type LiveSession } from "../live";
import { allCollectionSources, defToSpec } from "./sources";

/**
 * Time-bucketed usage rollups over the full session history (archive included).
 * Pure aggregation of already-parsed sessions — cheap on a warm cache.
 */

export interface RollupBucket {
  /** Bucket start, ms epoch (local weeks start Monday). */
  startMs: number;
  label: string; // e.g. "Jun 23"
  sessions: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}

export interface ProjectRollup {
  project: string;
  sessions: number;
  costUsd: number;
  tokens: number;
  lastActiveMs: number;
}

export interface RollupReport {
  weekly: RollupBucket[]; // oldest → newest, contiguous
  byProject: ProjectRollup[]; // by cost, top N
  anyEstimatedCost: boolean;
}

const WEEK_MS = 7 * 86_400_000;

/** Monday 00:00 local time of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d.getTime();
}

export function buildRollup(sessionsIn?: Array<LiveSession>, opts: { weeks?: number; topProjects?: number } = {}): RollupReport {
  const weeks = opts.weeks ?? 16;
  const topProjects = opts.topProjects ?? 8;

  let sessions = sessionsIn;
  if (!sessions) {
    sessions = [];
    for (const def of allCollectionSources()) {
      if (!def.parseable) continue;
      sessions.push(...collectSourceSessions(defToSpec(def), 100_000, { includeArchived: true }));
    }
  }

  const now = Date.now();
  const newestWeek = weekStart(now);
  const oldestWeek = newestWeek - (weeks - 1) * WEEK_MS;

  const buckets = new Map<number, RollupBucket>();
  for (let w = oldestWeek; w <= newestWeek; w += WEEK_MS) {
    buckets.set(w, {
      startMs: w,
      label: new Date(w).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      sessions: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0,
    });
  }

  const projects = new Map<string, ProjectRollup>();
  let anyEstimatedCost = false;

  for (const s of sessions) {
    if (!Number.isFinite(s.startedAt) || s.startedAt <= 0) continue;
    if (s.metricSources.cost === "inferred" && s.costUsd > 0) anyEstimatedCost = true;

    const w = weekStart(s.startedAt);
    const b = buckets.get(w);
    if (b) {
      b.sessions++;
      b.costUsd += s.costUsd || 0;
      b.inputTokens += s.inputTokens || 0;
      b.outputTokens += s.outputTokens || 0;
      b.toolCalls += s.toolCalls || 0;
    }

    const key = s.project || "(unknown)";
    const p = projects.get(key) ?? { project: key, sessions: 0, costUsd: 0, tokens: 0, lastActiveMs: 0 };
    p.sessions++;
    p.costUsd += s.costUsd || 0;
    p.tokens += (s.inputTokens || 0) + (s.outputTokens || 0);
    p.lastActiveMs = Math.max(p.lastActiveMs, s.lastEventAt || 0);
    projects.set(key, p);
  }

  return {
    weekly: [...buckets.values()].sort((a, b) => a.startMs - b.startMs),
    byProject: [...projects.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, topProjects),
    anyEstimatedCost,
  };
}
