import { buildRollup, type RollupReport } from "./rollup";
import {
  scanAllSourcesSnapshot,
  type AllSourcesResult,
  type CollectedSession,
} from "./aggregate";
import { buildTimeline, type TimelineReport } from "../insights/collect";
import { redactDisplay } from "../redaction";
import {
  createEvidenceContract,
  type EvidenceContract,
  type EvidenceDescriptor,
  type EvidenceProvenance,
} from "../../components/evidence/evidence-contract";

export interface SnapshotMetadata extends EvidenceContract {
  /** The time at which the value was actually generated, not served. */
  generatedAtMs: number;
  /** True when this value is older than the service freshness window. */
  stale: boolean;
  /** True while a refresh is running; the current value remains usable. */
  refreshing: boolean;
  /** Last refresh failure, if one occurred after a good value existed. */
  refreshError?: string;
  /** Shared serializable status for clients that do not want top-level fields. */
  evidence: EvidenceContract;
}

export interface SnapshotRead<T> extends SnapshotMetadata {
  value: T;
}

/** Optional envelope a loader may use to preserve source generation time. */
export interface SnapshotLoadResult<T> {
  value: T;
  generatedAtMs?: number;
  cacheable?: boolean;
  evidence?: EvidenceDescriptor;
}

type SnapshotLoader<T> = () => T | SnapshotLoadResult<T> | Promise<T | SnapshotLoadResult<T>>;

interface StoredSnapshot<T> {
  value: T;
  generatedAtMs: number;
  evidence: EvidenceDescriptor;
}

interface RefreshOutcome<T> {
  value: T;
  generatedAtMs: number;
  stored: boolean;
  evidence: EvidenceDescriptor;
}

export interface SnapshotServiceOptions<T> {
  load: SnapshotLoader<T>;
  maxAgeMs?: number;
  now?: () => number;
  cacheable?: (value: T) => boolean;
  evidence?: (value: T) => EvidenceDescriptor;
  provenance?: EvidenceProvenance;
}

export interface SnapshotGetOptions<T> {
  /** Start a refresh even when the current value is inside its age window. */
  forceRefresh?: boolean;
  /** Await the refresh. Use for the initial load and explicit bounded scans. */
  waitForRefresh?: boolean;
  /** One-shot loader override, useful for a caller-supplied scan budget. */
  loader?: SnapshotLoader<T>;
  /** One-shot cacheability override, e.g. partial values must not be retained. */
  cacheable?: (value: T) => boolean;
  /** One-shot evidence descriptor for a caller-specific bounded result. */
  evidence?: (value: T) => EvidenceDescriptor;
}

/**
 * Small deterministic in-process snapshot cache. It has no timers or worker
 * threads: stale reads kick one Promise-backed refresh and return immediately,
 * while concurrent reads share that Promise. Values are replaced atomically
 * only after a successful, cacheable load.
 */
export class SnapshotService<T> {
  private readonly load: SnapshotLoader<T>;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly defaultCacheable: (value: T) => boolean;
  private readonly describe: (value: T) => EvidenceDescriptor;
  private readonly defaultProvenance?: EvidenceProvenance;
  private current: StoredSnapshot<T> | null = null;
  private inFlight: Promise<RefreshOutcome<T>> | null = null;
  private refreshError: string | undefined;
  private lastFailedAtMs: number | null = null;
  private failedAttempts = 0;
  /** Invalidates refresh completions that were started before clear(). */
  private generation = 0;

  constructor(options: SnapshotServiceOptions<T>) {
    this.load = options.load;
    this.maxAgeMs = Math.max(0, options.maxAgeMs ?? 5_000);
    this.now = options.now ?? Date.now;
    this.defaultCacheable = options.cacheable ?? (() => true);
    this.describe = options.evidence ?? (() => ({}));
    this.defaultProvenance = options.provenance;
  }

  private normalize(value: T | SnapshotLoadResult<T>): SnapshotLoadResult<T> {
    if (
      typeof value === "object" && value !== null &&
      "value" in value &&
      ("generatedAtMs" in value || "cacheable" in value)
    ) {
      return value as SnapshotLoadResult<T>;
    }
    return { value: value as T };
  }

  private startRefresh(
    loader: SnapshotLoader<T> = this.load,
    cacheable = this.defaultCacheable,
    describe = this.describe,
    coalesce = true,
  ): Promise<RefreshOutcome<T>> {
    if (coalesce && this.inFlight) return this.inFlight;
    const generation = this.generation;
    const task = Promise.resolve()
      .then(() => loader())
      .then((loaded) => {
        const normalized = this.normalize(loaded);
        const generatedAtMs = normalized.generatedAtMs ?? this.now();
        const stored = generation === this.generation && (normalized.cacheable ?? cacheable(normalized.value));
        const evidence = normalized.evidence ?? describe(normalized.value);
        if (stored) {
          this.current = { value: normalized.value, generatedAtMs, evidence };
          this.refreshError = undefined;
          this.lastFailedAtMs = null;
          this.failedAttempts = 0;
        }
        return { value: normalized.value, generatedAtMs, stored, evidence };
      }, (error: unknown) => {
        if (generation === this.generation) {
          this.refreshError = redactDisplay(error instanceof Error ? error.message : String(error), { secrets: true }).slice(0, 240);
          this.lastFailedAtMs = this.now();
          this.failedAttempts += 1;
        }
        throw error;
      });
    if (!coalesce) return task;
    this.inFlight = task;
    // Clear only this generation's Promise. Background refreshes must not
    // create unhandled-rejection noise when the caller intentionally receives
    // the last-good value instead of awaiting the failure.
    void task.then(
      () => { if (this.inFlight === task) this.inFlight = null; },
      () => { if (this.inFlight === task) this.inFlight = null; },
    );
    return task;
  }

  private read(staleOverride?: boolean, refreshingOverride?: boolean): SnapshotRead<T> | null {
    if (!this.current) return null;
    const stale = staleOverride ?? (this.now() - this.current.generatedAtMs >= this.maxAgeMs);
    const refreshing = refreshingOverride ?? this.inFlight !== null;
    const retryAfterMs = this.lastFailedAtMs === null
      ? undefined
      : Math.max(0, this.maxAgeMs - (this.now() - this.lastFailedAtMs));
    const evidence = createEvidenceContract({
      generatedAt: this.current.generatedAtMs,
      stale,
      refreshing,
      error: this.refreshError ?? null,
      partial: this.current.evidence.partial,
      coverage: this.current.evidence.coverage,
      denominators: this.current.evidence.denominators,
      provenance: this.current.evidence.provenance ?? this.defaultProvenance,
      attempts: this.failedAttempts,
      retryAfterMs,
    });
    return {
      value: this.current.value,
      generatedAtMs: this.current.generatedAtMs,
      ...(this.refreshError ? { refreshError: this.refreshError } : {}),
      ...evidence,
      evidence,
    };
  }

  private readOutcome(outcome: RefreshOutcome<T>): SnapshotRead<T> {
    if (outcome.stored) return this.read(false, false)!;
    const evidence = createEvidenceContract({
      generatedAt: outcome.generatedAtMs,
      stale: true,
      partial: true,
      coverage: outcome.evidence.coverage,
      denominators: outcome.evidence.denominators,
      provenance: outcome.evidence.provenance ?? this.defaultProvenance,
      transient: true,
      attempts: this.failedAttempts,
    });
    return {
      value: outcome.value,
      generatedAtMs: outcome.generatedAtMs,
      ...evidence,
      evidence,
    };
  }

  async get(options: SnapshotGetOptions<T> = {}): Promise<SnapshotRead<T>> {
    const force = options.forceRefresh === true;
    const wait = options.waitForRefresh === true;
    const stale = this.current !== null && this.now() - this.current.generatedAtMs >= this.maxAgeMs;
    // Avoid a tight retry loop after a failed background refresh. The old
    // value remains explicitly stale/error until the backoff window elapses,
    // while forceRefresh is available for a user-initiated retry.
    const retryBackoffElapsed = this.lastFailedAtMs === null || this.now() - this.lastFailedAtMs >= this.maxAgeMs;
    const shouldRefresh = this.current === null || force || (stale && retryBackoffElapsed);

    if (this.current === null) {
      // A one-shot loader represents a caller-specific bounded contract and
      // must not inherit an unrelated unbounded refresh already in flight.
      const outcome = await this.startRefresh(
        options.loader,
        options.cacheable ?? this.defaultCacheable,
        options.evidence ?? this.describe,
        options.loader === undefined,
      );
      return this.readOutcome(outcome);
    }

    if (shouldRefresh) {
      const task = this.startRefresh(
        options.loader,
        options.cacheable ?? this.defaultCacheable,
        options.evidence ?? this.describe,
        options.loader === undefined,
      );
      if (wait) {
        try {
          return this.readOutcome(await task);
        } catch {
          // A previous value is still valid evidence, but is explicitly stale
          // and carries refreshError rather than being presented as fresh.
          return this.read(true)!;
        }
      }
      return this.read(true)!;
    }
    return this.read(stale)!;
  }

  /** Test/support seam for process-local lifecycle boundaries. */
  clear(): void {
    this.generation++;
    this.current = null;
    this.inFlight = null;
    this.refreshError = undefined;
    this.lastFailedAtMs = null;
    this.failedAttempts = 0;
  }
}

const COLLECTION_SNAPSHOT_LIMIT = 10_000;
// Collection and Timeline are machine-wide analytical views, not the 10-second
// Live monitor. Keep their process cache aligned with the API's 30-second
// freshness window so navigation does not re-walk thousands of transcript
// files every five seconds.
const ANALYTICS_SNAPSHOT_MAX_AGE_MS = 30_000;

export interface CollectionSnapshotValue {
  aggregate: AllSourcesResult;
  sessions: CollectedSession[];
  rollup?: RollupReport;
}

function loadCollectionSnapshot(budgetMs?: number): SnapshotLoadResult<CollectionSnapshotValue> {
  const source = scanAllSourcesSnapshot(COLLECTION_SNAPSHOT_LIMIT, { fresh: true, budgetMs });
  const { aggregate } = source;
  // A budget-cut aggregate is a transient response. Do not collect a second,
  // potentially complete history behind the caller's back or retain a partial
  // value as canonical state.
  if (aggregate.partial) {
    return {
      value: { aggregate, sessions: [] },
      generatedAtMs: aggregate.generatedAtMs,
      cacheable: false,
    };
  }
  const sessions = source.sessions;
  const rollup = buildRollup(sessions);
  // Freshness starts when the complete snapshot is ready, not when discovery
  // finished. On a large corpus the rollup can take longer than maxAgeMs;
  // stamping discovery time would make a brand-new snapshot immediately stale
  // and trigger an endless refresh loop under load.
  const generatedAtMs = Date.now();
  return {
    value: { aggregate: { ...aggregate, generatedAtMs }, sessions, rollup },
    generatedAtMs,
  };
}

export const collectionSnapshotService = new SnapshotService<CollectionSnapshotValue>({
  load: () => loadCollectionSnapshot(),
  maxAgeMs: ANALYTICS_SNAPSHOT_MAX_AGE_MS,
  cacheable: (value) => !value.aggregate.partial,
});

export async function getCollectionSnapshot(options: { budgetMs?: number; forceRefresh?: boolean } = {}): Promise<SnapshotRead<CollectionSnapshotValue>> {
  if (options.budgetMs === undefined) {
    return collectionSnapshotService.get({
      forceRefresh: options.forceRefresh === true,
      waitForRefresh: options.forceRefresh === true,
    });
  }
  return collectionSnapshotService.get({
    forceRefresh: true,
    waitForRefresh: true,
    loader: () => loadCollectionSnapshot(options.budgetMs),
  });
}

const timelineSnapshotService = new SnapshotService<TimelineReport>({
  load: async () => {
    const collection = await getCollectionSnapshot();
    const value = buildTimeline(collection.value.sessions);
    return {
      value,
      // Timeline derivation is part of snapshot generation. Use its completion
      // time so a slow longitudinal analysis is not stale before it is served.
      generatedAtMs: Date.now(),
      cacheable: !collection.stale && !collection.refreshing,
    };
  },
  maxAgeMs: ANALYTICS_SNAPSHOT_MAX_AGE_MS,
});

export async function getTimelineSnapshot(options: { forceRefresh?: boolean } = {}): Promise<SnapshotRead<TimelineReport>> {
  // A forced Timeline refresh must cross the entire dependency chain. Merely
  // forcing the derived report can rebuild it from the last-good Collection
  // snapshot while that snapshot is still inside its own freshness window.
  const forceRefresh = options.forceRefresh === true;
  const collection = await getCollectionSnapshot({ forceRefresh });
  // Propagate collection staleness to the derived report. This may return the
  // old timeline immediately while one coalesced rebuild runs in the background.
  const timeline = await timelineSnapshotService.get({
    forceRefresh: forceRefresh || collection.stale || collection.refreshing,
    waitForRefresh: forceRefresh,
  });
  return {
    ...timeline,
    stale: timeline.stale || collection.stale,
    refreshing: timeline.refreshing || collection.refreshing,
    ...(collection.refreshError ? { refreshError: collection.refreshError } : {}),
  };
}

export function _clearSnapshotServicesForTest(): void {
  collectionSnapshotService.clear();
  timelineSnapshotService.clear();
}
