import { getRun, listEvents } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE stream of run events.
 *
 * Replay window: the `events` table is append-only and never pruned per run,
 * so resume can replay a run's ENTIRE event history — a fresh connect (cursor
 * 0) replays from the first event. Replay is paged EVENT_BATCH rows per DB
 * query and fully drained before the stream goes idle, so a resuming client
 * catches up in one flush rather than one batch per poll tick. Event ids are
 * the global AUTOINCREMENT ids of the `events` table: monotonically
 * increasing within a run but not contiguous.
 *
 * Resume: the client supplies its last seen event id either via the standard
 * `Last-Event-ID` header (sent automatically by EventSource auto-reconnect)
 * or the `lastEventId` query param (used by useRunEvents on manual backoff
 * reconnects, where a freshly constructed EventSource does not send the
 * header). When both are present the FRESHEST (highest) cursor wins: a
 * browser auto-retry of a URL that carries a stale query cursor sends a newer
 * header, and preferring the query param there would re-replay the gap.
 *
 * Cadence: the DB is polled every OPENEVAL_SSE_POLL_MS (default 600ms, min
 * 25); a `: ping` comment heartbeat is written after every
 * OPENEVAL_SSE_HEARTBEAT_MS (default 15000ms, floored at the poll interval)
 * of idle time so proxies do not time out a quiet connection.
 *
 * Termination: the stream is guaranteed to close once the run is terminal —
 * either by flushing a run_completed/run_fatal/run_aborted event, or by observing a
 * terminal (or deleted) run in the DB, which covers runs that died without
 * writing a completion event. Client aborts and stream cancellation both go
 * through the same idempotent stop path, so a closed stream can never leak a
 * poll interval.
 */

const isTerminalRun = (run: { status?: string } | null) =>
  run?.status === "completed" || run?.status === "failed" || run?.status === "aborted";

const EVENT_BATCH = 200;

const TERMINAL_EVENT_KINDS = new Set(["run_completed", "run_fatal", "run_aborted"]);

function envInt(name: string, fallback: number, min: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.floor(raw));
}

/**
 * Freshest cursor wins between the query param (manual reconnect) and the
 * Last-Event-ID header (browser auto-reconnect, which retries the SAME URL —
 * possibly one carrying an older query cursor — with a newer header).
 */
function resolveLastEventId(request: Request): number {
  let fromQuery = NaN;
  try {
    fromQuery = Number(new URL(request.url).searchParams.get("lastEventId"));
  } catch {
    // Unparseable URL — fall through to the header
  }
  const fromHeader = Number(request.headers.get("Last-Event-ID"));
  const cursor = Math.max(
    Number.isFinite(fromQuery) ? Math.floor(fromQuery) : 0,
    Number.isFinite(fromHeader) ? Math.floor(fromHeader) : 0,
  );
  return cursor > 0 ? cursor : 0;
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const pollMs = envInt("OPENEVAL_SSE_POLL_MS", 600, 25);
  const heartbeatMs = Math.max(envInt("OPENEVAL_SSE_HEARTBEAT_MS", 15_000, 25), pollMs);
  const heartbeatEveryTicks = Math.max(1, Math.round(heartbeatMs / pollMs));

  let sinceId = resolveLastEventId(request);
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  const clearPoll = () => { if (interval) { clearInterval(interval); interval = undefined; } };

  const encoder = new TextEncoder();
  const heartbeat = encoder.encode(`: ping\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Single termination path: idempotent, always clears the poll timer so a
      // closed stream can never leak an interval that fires forever.
      const stop = () => {
        if (closed) return;
        closed = true;
        clearPoll();
        try { controller.close(); } catch {}
      };

      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      controller.enqueue(heartbeat);

      // Drain the full backlog: page EVENT_BATCH rows at a time until caught
      // up, or until a terminal event closes the stream.
      const flush = (): "terminal" | "wrote" | "idle" => {
        let wrote = false;
        for (;;) {
          const events = listEvents(params.id, sinceId, EVENT_BATCH);
          if (events.length === 0) return wrote ? "wrote" : "idle";
          for (const ev of events) {
            // A single corrupt payload_json row must not wedge the stream: if
            // it threw out of flush, sinceId would never advance past it and
            // every poll would re-read the same poison row forever.
            let data: unknown = null;
            try { data = JSON.parse(ev.payload_json); } catch {}
            const payload = JSON.stringify({
              id: ev.id,
              kind: ev.kind,
              case_id: ev.case_id,
              at: ev.at,
              data,
            });
            const frame = `id: ${ev.id}\nevent: ${ev.kind}\ndata: ${payload}\n\n`;
            controller.enqueue(encoder.encode(frame));
            sinceId = ev.id;
            wrote = true;
            if (TERMINAL_EVENT_KINDS.has(ev.kind)) {
              stop();
              return "terminal";
            }
          }
          if (events.length < EVENT_BATCH) return "wrote";
        }
      };

      let idleTicks = 0;
      const poll = () => {
        if (closed) return;
        try {
          const outcome = flush();
          if (outcome === "terminal") return;
          if (outcome === "wrote") idleTicks = 0;
          else idleTicks++;
        } catch {
          // DB transient — keep alive, count as idle so heartbeats still flow
          idleTicks++;
        }
        if (idleTicks >= heartbeatEveryTicks) {
          idleTicks = 0;
          try { controller.enqueue(heartbeat); } catch {}
        }
        // Guaranteed close: a terminal (or deleted) run ends the stream even
        // when no run_completed/run_fatal event was ever written.
        const current = getRun(params.id);
        if (!current || isTerminalRun(current)) {
          stop();
        }
      };

      interval = setInterval(poll, pollMs);
      poll();

      // A listener added to an already-aborted signal never fires.
      if (request.signal.aborted) stop();
      else request.signal.addEventListener("abort", stop);
    },
    cancel() {
      closed = true;
      clearPoll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
