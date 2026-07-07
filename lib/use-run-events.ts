"use client";

import { useEffect, useRef, useState } from "react";

export type RunEvent = {
  id: number;
  kind: string;
  case_id: string | null;
  at: number;
  data: any;
};

type Status = "idle" | "connecting" | "open" | "closed";

/**
 * Subscribe to the SSE event stream for a single run.
 *
 * Pass `enabled: false` to keep the connection closed (e.g. once the run is
 * no longer live). The hook keeps a rolling buffer of the most recent events and
 * also fires `onEvent` for each new frame so callers can debounce refetches
 * without waiting on the next poll tick.
 */
export function useRunEvents(
  runId: string | null | undefined,
  opts: { enabled?: boolean; onEvent?: (ev: RunEvent) => void; buffer?: number } = {},
): { status: Status; lastEvent: RunEvent | null } {
  const { enabled = true, onEvent, buffer = 200 } = opts;
  const [status, setStatus] = useState<Status>("idle");
  const [lastEvent, setLastEvent] = useState<RunEvent | null>(null);

  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!runId || !enabled) {
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    let es: EventSource | null = null;
    let stopped = false;
    const seen = new Set<number>();
    const events: RunEvent[] = [];

    const handleMessage = (kind: string) => (msg: MessageEvent) => {
      if (stopped) return;
      try {
        const ev = JSON.parse(msg.data) as RunEvent;
        if (ev.id != null && seen.has(ev.id)) return;
        seen.add(ev.id);
        ev.kind = kind;
        events.push(ev);
        if (events.length > buffer) {
          const dropped = events.shift();
          if (dropped) seen.delete(dropped.id);
        }
        setLastEvent(ev);
        onEventRef.current?.(ev);
        if (kind === "run_completed" || kind === "run_fatal") {
          es?.close();
          setStatus("closed");
        }
      } catch {
        // Malformed payload — ignore
      }
    };

    es = new EventSource(`/api/runs/${runId}/events/stream`);
    es.onopen = () => { if (!stopped) setStatus("open"); };
    es.onerror = () => {
      if (stopped) return;
      setStatus(es?.readyState === EventSource.CLOSED ? "closed" : "connecting");
    };

    const kinds = [
      "run_started", "run_completed", "run_fatal",
      "case_started", "case_grading", "case_finished",
      "tool_use", "tool_result", "assistant_message", "grader_result",
    ];
    // Default untyped listener — fires for events without an explicit `event:` field
    // and for the named events we didn't subscribe to explicitly.
    const generic = handleMessage("__default__");
    es.onmessage = (msg) => generic(new MessageEvent("message", { data: msg.data }));
    for (const k of kinds) {
      // EventSource typed listeners via addEventListener; `onmessage` covers the
      // untyped case, but named events arrive as addEventListener-only.
      es.addEventListener(k, ((msg: MessageEvent) => handleMessage(k)(msg)) as EventListener);
    }

    return () => {
      stopped = true;
      es?.close();
    };
  }, [runId, enabled, buffer]);

  return { status, lastEvent };
}