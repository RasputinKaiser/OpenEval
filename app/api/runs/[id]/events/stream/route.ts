import { getRun, listEvents } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const isTerminalRun = (run: { status?: string } | null) =>
  run?.status === "completed" || run?.status === "failed" || run?.status === "aborted";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const lastEventId = Number(request.headers.get("Last-Event-ID") || "0") || 0;
  let sinceId = lastEventId;
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

      const flush = (): boolean => {
        const events = listEvents(params.id, sinceId, 200);
        if (events.length === 0) return false;
        for (const ev of events) {
          const payload = JSON.stringify({
            id: ev.id,
            kind: ev.kind,
            case_id: ev.case_id,
            at: ev.at,
            data: JSON.parse(ev.payload_json),
          });
          const frame = `id: ${ev.id}\nevent: ${ev.kind}\ndata: ${payload}\n\n`;
          controller.enqueue(encoder.encode(frame));
          sinceId = ev.id;
          if (ev.kind === "run_completed" || ev.kind === "run_fatal") {
            stop();
            return true;
          }
        }
        return false;
      };

      let idleTicks = 0;
      const poll = () => {
        if (closed) return;
        try {
          if (flush()) return;
        } catch {
          // DB transient — keep alive
        }
        idleTicks++;
        if (idleTicks % 25 === 0) {
          try { controller.enqueue(heartbeat); } catch {}
        }
        // Auto-close if run ended server-side without a completion event
        const current = getRun(params.id);
        if (current && isTerminalRun(current)) {
          stop();
        }
      };

      interval = setInterval(poll, 600);
      poll();

      request.signal.addEventListener("abort", stop);
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