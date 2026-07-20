"use client";

import { useEffect, useRef, useState } from "react";

export type RunEvent = {
  id: number;
  kind: string;
  case_id: string | null;
  at: number;
  data: any;
};

export type RunEventsStatus =
  | "idle"         // no run / disabled
  | "connecting"   // first connection attempt in flight
  | "open"         // stream live
  | "reconnecting" // dropped; backoff timer or retry in flight
  | "paused"       // tab hidden; will resume (with replay) on visibility
  | "closed";      // terminal — run finished, no reconnects

export const SSE_BACKOFF_BASE_MS = 1_000;
export const SSE_BACKOFF_MAX_MS = 30_000;

/**
 * Exponential backoff with half-jitter: attempt n waits in
 * [cap/2, cap] where cap = min(maxMs, baseMs * 2^n). Pure so reconnect
 * pacing is testable without a DOM. `random` is injectable for tests.
 */
export function computeBackoffDelay(
  attempt: number,
  random: () => number = Math.random,
  baseMs: number = SSE_BACKOFF_BASE_MS,
  maxMs: number = SSE_BACKOFF_MAX_MS,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(Math.max(attempt, 0), 20));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/**
 * Stream URL for a run, carrying the resume cursor as a query param. A freshly
 * constructed EventSource never sends the Last-Event-ID header (only the
 * browser's internal auto-reconnect does), so manual backoff reconnects pass
 * the cursor here; the route accepts both and prefers the query param.
 */
export function buildStreamUrl(runId: string, lastEventId?: number | null): string {
  const base = `/api/runs/${encodeURIComponent(runId)}/events/stream`;
  return typeof lastEventId === "number" && Number.isFinite(lastEventId) && lastEventId > 0
    ? `${base}?lastEventId=${Math.floor(lastEventId)}`
    : base;
}

/**
 * Manual (backoff) reconnect is only needed once the browser has given up:
 * readyState CLOSED (2). CONNECTING (0) after an error means the browser's own
 * auto-retry — which resends Last-Event-ID itself — is already in flight.
 */
export function shouldManualReconnect(readyState: number): boolean {
  return readyState === 2;
}

const EVENT_KINDS = [
  "run_started", "run_completed", "run_fatal", "run_aborted",
  "case_started", "case_grading", "case_finished",
  "tool_use", "tool_result", "assistant_message", "grader_result",
];

// run_aborted counts: cancelled/orphan-reaped runs end with it INSTEAD of
// run_completed, and without it here the hook would reconnect-churn against a
// server that closes every stream for the terminal run.
const TERMINAL_KINDS = new Set(["run_completed", "run_fatal", "run_aborted"]);

/**
 * Subscribe to the SSE event stream for a single run.
 *
 * Pass `enabled: false` to keep the connection closed (e.g. once the run is
 * no longer live). The hook keeps a rolling buffer of the most recent events
 * and also fires `onEvent` for each new frame so callers can debounce
 * refetches without waiting on the next poll tick.
 *
 * Lifecycle hardening:
 * - Dropped connections reconnect with exponential backoff + jitter and
 *   resume from the last seen event id (server replays the gap).
 * - While the tab is hidden the stream is closed (`status: "paused"`) and
 *   reopened with resume on visibility, so background tabs hold no sockets
 *   but never miss events.
 * - A terminal event (run_completed/run_fatal/run_aborted) closes the stream
 *   for good.
 */
export function useRunEvents(
  runId: string | null | undefined,
  opts: {
    enabled?: boolean;
    onEvent?: (ev: RunEvent) => void;
    buffer?: number;
    /** Close the stream while the tab is hidden and resume on visibility. Default true. */
    pauseWhenHidden?: boolean;
  } = {},
): {
  status: RunEventsStatus;
  lastEvent: RunEvent | null;
  /** Highest event id seen — the resume cursor. Null until the first event. */
  lastEventId: number | null;
  /** Consecutive failed reconnect attempts; 0 while healthy. */
  reconnectAttempt: number;
} {
  const { enabled = true, onEvent, buffer = 200, pauseWhenHidden = true } = opts;
  const [status, setStatus] = useState<RunEventsStatus>("idle");
  const [lastEvent, setLastEvent] = useState<RunEvent | null>(null);
  const [lastEventId, setLastEventId] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!runId || !enabled) {
      setStatus("idle");
      return;
    }

    let es: EventSource | null = null;
    let stopped = false;   // effect torn down
    let terminal = false;  // run finished — never reconnect
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastId = 0;
    const seen = new Set<number>();
    const events: RunEvent[] = [];

    const clearReconnectTimer = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };
    const teardownSource = () => {
      if (es) { es.close(); es = null; }
    };

    const handleMessage = (kind: string) => (msg: MessageEvent) => {
      if (stopped) return;
      try {
        const ev = JSON.parse(msg.data) as RunEvent;
        if (ev.id != null && seen.has(ev.id)) return;
        if (typeof ev.id === "number") {
          seen.add(ev.id);
          if (ev.id > lastId) {
            lastId = ev.id;
            setLastEventId(ev.id);
          }
        }
        // Untyped frames keep the payload's own kind; named frames trust the
        // SSE event name.
        if (kind !== "__default__") ev.kind = kind;
        events.push(ev);
        if (events.length > buffer) {
          const dropped = events.shift();
          if (dropped) seen.delete(dropped.id);
        }
        setLastEvent(ev);
        onEventRef.current?.(ev);
        if (TERMINAL_KINDS.has(ev.kind)) {
          terminal = true;
          clearReconnectTimer();
          teardownSource();
          setStatus("closed");
        }
      } catch {
        // Malformed payload — ignore
      }
    };

    const scheduleReconnect = () => {
      if (stopped || terminal) return;
      setStatus("reconnecting");
      const delay = computeBackoffDelay(attempt);
      attempt += 1;
      setReconnectAttempt(attempt);
      clearReconnectTimer();
      reconnectTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (stopped || terminal) return;
      clearReconnectTimer();
      teardownSource();
      if (pauseWhenHidden && typeof document !== "undefined" && document.visibilityState === "hidden") {
        setStatus("paused");
        return; // the visibilitychange listener resumes us
      }
      setStatus(attempt > 0 ? "reconnecting" : "connecting");
      const src = new EventSource(buildStreamUrl(runId!, lastId));
      es = src;
      src.onopen = () => {
        if (stopped || src !== es) return;
        attempt = 0;
        setReconnectAttempt(0);
        setStatus("open");
      };
      src.onerror = () => {
        if (stopped || src !== es) return;
        if (shouldManualReconnect(src.readyState)) {
          teardownSource();
          scheduleReconnect();
        } else {
          // Browser auto-retry in flight — it resends Last-Event-ID itself.
          setStatus("reconnecting");
        }
      };
      const generic = handleMessage("__default__");
      src.onmessage = (msg) => generic(msg);
      for (const k of EVENT_KINDS) {
        src.addEventListener(k, handleMessage(k) as EventListener);
      }
    }

    const onVisibilityChange = () => {
      if (stopped || terminal || !pauseWhenHidden) return;
      if (document.visibilityState === "hidden") {
        clearReconnectTimer();
        teardownSource();
        setStatus("paused");
      } else {
        attempt = 0;
        setReconnectAttempt(0);
        connect();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    connect();

    return () => {
      stopped = true;
      clearReconnectTimer();
      teardownSource();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [runId, enabled, buffer, pauseWhenHidden]);

  return { status, lastEvent, lastEventId, reconnectAttempt };
}
