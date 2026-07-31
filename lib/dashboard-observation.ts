import {
  collectAllSessions,
  scanAllSources,
  type AllSourcesResult,
  type CollectedSession,
} from "./collection/aggregate";
import { buildTimeline, type TimelineReport, type TimelineSession } from "./insights/collect";
import { redactDisplay } from "./redaction";
import { getCollectionSnapshot, getTimelineSnapshot } from "./collection/snapshot-service";

export interface DashboardObservation {
  collection: AllSourcesResult | null;
  timeline: DashboardTimeline | null;
  collectionError: string | null;
  timelineError: string | null;
}

export type DashboardTimeline = TimelineReport & {
  generatedAtMs?: number;
  stale?: boolean;
  refreshing?: boolean;
  refreshError?: string;
};

/**
 * Dashboard loader backed by the same last-good snapshots as Collection and
 * Timeline. Keep the synchronous dependency-injected loader below for small
 * unit tests and isolated failure tests; production pages should use this
 * async path so the home view does not run a separate corpus derivation.
 */
export async function loadDashboardObservationSnapshot(): Promise<DashboardObservation> {
  let collection: AllSourcesResult | null = null;
  let timeline: DashboardTimeline | null = null;
  let collectionError: string | null = null;
  let timelineError: string | null = null;

  try {
    const snapshot = await getCollectionSnapshot();
    collection = {
      ...snapshot.value.aggregate,
      generatedAtMs: snapshot.generatedAtMs,
      stale: snapshot.stale,
      refreshing: snapshot.refreshing,
      ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
    };
    collectionError = snapshot.refreshError ?? null;
  } catch (error) {
    collectionError = errorMessage(error);
  }

  try {
    const snapshot = await getTimelineSnapshot();
    timeline = {
      ...snapshot.value,
      generatedAtMs: snapshot.generatedAtMs,
      stale: snapshot.stale,
      refreshing: snapshot.refreshing,
      ...(snapshot.refreshError ? { refreshError: snapshot.refreshError } : {}),
    };
    timelineError = snapshot.refreshError ?? null;
  } catch (error) {
    timelineError = errorMessage(error);
  }

  return { collection, timeline, collectionError, timelineError };
}

interface DashboardObservationLoaders {
  scanCollection: (limit: number) => AllSourcesResult;
  collectSessions: () => CollectedSession[];
  buildTimeline: (sessions: TimelineSession[]) => TimelineReport;
}

const DEFAULT_LOADERS: DashboardObservationLoaders = {
  scanCollection: scanAllSources,
  collectSessions: collectAllSessions,
  buildTimeline,
};

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactDisplay(raw, { secrets: true }).slice(0, 240);
}

/**
 * Load the Observe half of the dashboard without conflating an unavailable
 * source with an empty one. Collection and timeline are independent proof
 * surfaces: either may fail while the Evaluate half of the dashboard remains
 * usable, and the caller receives the exact failure state to render.
 */
export function loadDashboardObservation(
  loaders: DashboardObservationLoaders = DEFAULT_LOADERS,
): DashboardObservation {
  let collection: AllSourcesResult | null = null;
  let timeline: DashboardTimeline | null = null;
  let collectionError: string | null = null;
  let timelineError: string | null = null;

  try {
    collection = loaders.scanCollection(12);
  } catch (error) {
    collectionError = errorMessage(error);
  }

  try {
    timeline = loaders.buildTimeline(loaders.collectSessions());
  } catch (error) {
    timelineError = errorMessage(error);
  }

  return { collection, timeline, collectionError, timelineError };
}
