/**
 * The client keeps rendering the last report while a background judge runs.
 * Keep the user-facing freshness state derived from explicit inputs so the
 * polling transitions can be tested without mounting a React component.
 */
export type TimelineRefreshPhase = "loading" | "fresh" | "stale" | "error";

export interface TimelineRefreshSnapshot {
  hasData: boolean;
  loading: boolean;
  stale?: boolean;
  error?: string | null;
}

export function timelineRefreshPhase(snapshot: TimelineRefreshSnapshot): TimelineRefreshPhase {
  if (snapshot.loading) return "loading";
  if (snapshot.error) return "error";
  if (snapshot.stale) return "stale";
  return snapshot.hasData ? "fresh" : "error";
}

/** A terminal/no-op status must not keep a four-second timer alive. */
export function shouldPollJudgeStatus(status: { running?: boolean } | null | undefined): boolean {
  return status?.running === true;
}

export function timelinePollError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
