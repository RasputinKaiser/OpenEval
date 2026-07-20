import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RunRecord } from "../lib/types";

// lib/config captures ROOT from process.cwd() at import time, so the DB must
// be redirected into a temp dir BEFORE the route module — and through it
// lib/db — is imported. Route imports below are dynamic for that reason.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-sse-"));
process.chdir(tempRoot);

after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function importStream() {
  const streamRoute = await import("../app/api/runs/[id]/events/stream/route");
  const db = await import("../lib/db");
  return { streamRoute, db };
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: randomUUID().slice(0, 8),
    name: "sse test run",
    status: "running",
    created_at: Date.now(),
    ended_at: null,
    params: { runner: "headless", parallel: 1 },
    summary: null,
    ...over,
  };
}

function streamRequest(runId: string, init: RequestInit & { query?: string } = {}): Request {
  const { query = "", ...rest } = init;
  return new Request(`http://localhost:3125/api/runs/${runId}/events/stream${query}`, rest);
}

const routeProps = (id: string) => ({ params: Promise.resolve({ id }) });

type ParsedEvent = { id: number; event: string; data: any };

function parseSseEvents(raw: string): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const block of raw.split("\n\n")) {
    let id: number | null = null;
    let event: string | null = null;
    let data: any = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) id = Number(line.slice(4));
      else if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = JSON.parse(line.slice(6));
    }
    if (id != null && event != null) out.push({ id, event, data });
  }
  return out;
}

/**
 * Read an SSE response body until the stream ends, `stopWhen` matches the
 * accumulated text, or `timeoutMs` elapses. Cancels the reader on exit so the
 * route's poll interval is always cleared.
 */
async function collect(
  res: Response,
  { stopWhen, timeoutMs = 5000 }: { stopWhen?: (raw: string) => boolean; timeoutMs?: number } = {},
): Promise<{ raw: string; ended: boolean }> {
  assert.ok(res.body, "response has a body stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), remaining); }),
      ]);
      if (timer) clearTimeout(timer);
      if (chunk === null) break; // timed out
      if (chunk.done) { ended = true; break; }
      raw += decoder.decode(chunk.value, { stream: true });
      if (stopWhen?.(raw)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch {}
  }
  return { raw, ended };
}

function countPings(raw: string): number {
  return raw.split("\n\n").filter((b) => b.trim() === ": ping").length;
}

test("missing run returns 404 without opening a stream", async () => {
  const { streamRoute } = await importStream();
  const res = await streamRoute.GET(streamRequest("does-not-exist"), routeProps("does-not-exist"));
  assert.equal(res.status, 404);
});

test("terminal run: replays events in order and closes the stream", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  db.insertRun(run);
  db.appendEvent(run.id, "run_started", { at: 1 });
  db.appendEvent(run.id, "case_finished", { case: "c1" }, "c1");
  db.appendEvent(run.id, "run_completed", { ok: true });

  const res = await streamRoute.GET(streamRequest(run.id), routeProps(run.id));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream");

  const { raw, ended } = await collect(res);
  assert.equal(ended, true, "stream must end on the terminal event");
  const events = parseSseEvents(raw);
  assert.deepEqual(events.map((e) => e.event), ["run_started", "case_finished", "run_completed"]);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].id > events[i - 1].id, "ids ascend");
  assert.equal(events[1].data.case_id, "c1");
  assert.match(raw, /^retry: 2000\n\n/, "advertises a retry interval for browser auto-reconnect");
});

test("resume after drop: Last-Event-ID header replays only events past the cursor", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);
  for (let i = 0; i < 5; i++) db.appendEvent(run.id, "tool_use", { seq: i });

  // First connection: take the full backlog, then drop it mid-run.
  const abort = new AbortController();
  const res1 = await streamRoute.GET(
    streamRequest(run.id, { signal: abort.signal }),
    routeProps(run.id),
  );
  const first = await collect(res1, { stopWhen: (raw) => parseSseEvents(raw).length >= 5 });
  abort.abort();
  const firstEvents = parseSseEvents(first.raw);
  assert.equal(firstEvents.length, 5);
  assert.deepEqual(firstEvents.map((e) => e.data.data.seq), [0, 1, 2, 3, 4]);

  // Reconnect resuming from the 3rd event's id: only 4th and 5th replay.
  const cursor = firstEvents[2].id;
  const res2 = await streamRoute.GET(
    streamRequest(run.id, { headers: { "Last-Event-ID": String(cursor) } }),
    routeProps(run.id),
  );
  const second = await collect(res2, { stopWhen: (raw) => parseSseEvents(raw).length >= 2 });
  const secondEvents = parseSseEvents(second.raw);
  assert.deepEqual(secondEvents.map((e) => e.id), [firstEvents[3].id, firstEvents[4].id]);
  assert.ok(secondEvents.every((e) => e.id > cursor), "no replay at or before the cursor");
});

test("resume: freshest cursor wins between lastEventId query param and header", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);
  for (let i = 0; i < 4; i++) db.appendEvent(run.id, "tool_result", { seq: i });
  const all = db.listEvents(run.id, 0, 100);
  assert.equal(all.length, 4);

  // Query param fresher than header (manual reconnect with a stale header).
  const res1 = await streamRoute.GET(
    streamRequest(run.id, {
      query: `?lastEventId=${all[2].id}`,
      headers: { "Last-Event-ID": String(all[0].id) },
    }),
    routeProps(run.id),
  );
  const first = await collect(res1, { stopWhen: (r) => parseSseEvents(r).length >= 1 });
  assert.deepEqual(parseSseEvents(first.raw).map((e) => e.id), [all[3].id]);

  // Header fresher than query param: browser auto-reconnect retries the SAME
  // URL (stale query cursor) but sends the newer Last-Event-ID header — the
  // stale query param must not force a re-replay of the gap.
  const res2 = await streamRoute.GET(
    streamRequest(run.id, {
      query: `?lastEventId=${all[0].id}`,
      headers: { "Last-Event-ID": String(all[2].id) },
    }),
    routeProps(run.id),
  );
  const second = await collect(res2, { stopWhen: (r) => parseSseEvents(r).length >= 1 });
  assert.deepEqual(parseSseEvents(second.raw).map((e) => e.id), [all[3].id]);
});

test("run_aborted is terminal: replayed to the client, then the stream closes", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun({ status: "aborted", ended_at: Date.now() });
  db.insertRun(run);
  db.appendEvent(run.id, "run_started", { at: 1 });
  db.appendEvent(run.id, "run_aborted", { reason: "cancelled" });

  const res = await streamRoute.GET(streamRequest(run.id), routeProps(run.id));
  const { raw, ended } = await collect(res);
  assert.equal(ended, true, "run_aborted must close the stream like run_completed");
  assert.deepEqual(parseSseEvents(raw).map((e) => e.event), ["run_started", "run_aborted"]);
});

test("malformed resume cursors fall back to a full replay", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);
  db.appendEvent(run.id, "case_started", { seq: 0 }, "c1");

  const res = await streamRoute.GET(
    streamRequest(run.id, {
      query: "?lastEventId=bogus",
      headers: { "Last-Event-ID": "-12" },
    }),
    routeProps(run.id),
  );
  const { raw } = await collect(res, { stopWhen: (r) => parseSseEvents(r).length >= 1 });
  assert.equal(parseSseEvents(raw).length, 1, "cursor sanitized to 0 → full replay");
});

test("backlog larger than one batch drains in a single connect", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun({ status: "completed", ended_at: Date.now() });
  db.insertRun(run);
  for (let i = 0; i < 250; i++) db.appendEvent(run.id, "tool_use", { seq: i });
  db.appendEvent(run.id, "run_completed", { ok: true });

  const started = Date.now();
  const res = await streamRoute.GET(streamRequest(run.id), routeProps(run.id));
  const { raw, ended } = await collect(res);
  const events = parseSseEvents(raw);
  assert.equal(ended, true);
  assert.equal(events.length, 251, "full backlog including the terminal event");
  for (let i = 1; i < events.length; i++) assert.ok(events[i].id > events[i - 1].id);
  // Draining 251 events must not take one poll tick (600ms) per 200-row batch.
  assert.ok(Date.now() - started < 2000, "backlog drained without per-batch poll delays");
});

test("stream closes when the run goes terminal without a completion event", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);
  db.appendEvent(run.id, "run_started", { at: 1 });

  process.env.OPENEVAL_SSE_POLL_MS = "25";
  try {
    const res = await streamRoute.GET(streamRequest(run.id), routeProps(run.id));
    const flip = setTimeout(() => db.updateRunStatus(run.id, "completed", Date.now(), null), 100);
    const { raw, ended } = await collect(res, { timeoutMs: 4000 });
    clearTimeout(flip);
    assert.equal(ended, true, "terminal DB status must close the stream even with no run_completed event");
    assert.equal(parseSseEvents(raw).length, 1, "prior events still replayed");
  } finally {
    delete process.env.OPENEVAL_SSE_POLL_MS;
  }
});

test("heartbeat cadence honors OPENEVAL_SSE_HEARTBEAT_MS", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);

  process.env.OPENEVAL_SSE_POLL_MS = "25";
  process.env.OPENEVAL_SSE_HEARTBEAT_MS = "50";
  try {
    const abort = new AbortController();
    const res = await streamRoute.GET(
      streamRequest(run.id, { signal: abort.signal }),
      routeProps(run.id),
    );
    // One ping is written at connect; ~every 50ms idle after that. Waiting for
    // 4 total proves the recurring cadence, not just the greeting.
    const { raw } = await collect(res, { stopWhen: (r) => countPings(r) >= 4, timeoutMs: 4000 });
    abort.abort();
    assert.ok(countPings(raw) >= 4, `expected recurring heartbeats, saw ${countPings(raw)}`);
  } finally {
    delete process.env.OPENEVAL_SSE_POLL_MS;
    delete process.env.OPENEVAL_SSE_HEARTBEAT_MS;
  }
});

test("client abort closes the stream via the request signal", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);
  db.appendEvent(run.id, "run_started", { at: 1 });

  const abort = new AbortController();
  const res = await streamRoute.GET(
    streamRequest(run.id, { signal: abort.signal }),
    routeProps(run.id),
  );
  // One reader, never cancelled until the end: the ONLY thing that can close
  // this stream is the abort listener firing — if it does not, read() hangs
  // past the deadline and the test fails.
  assert.ok(res.body);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let ended = false;
  const deadline = Date.now() + 4000;
  try {
    while (Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deadline - Date.now()); }),
      ]);
      if (timer) clearTimeout(timer);
      if (chunk === null) break;
      if (chunk.done) { ended = true; break; }
      raw += decoder.decode(chunk.value, { stream: true });
      if (parseSseEvents(raw).length >= 1) abort.abort();
    }
  } finally {
    await reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch {}
  }
  assert.equal(parseSseEvents(raw).length, 1, "event delivered before the abort");
  assert.equal(ended, true, "abort signal must close the stream");
});

test("already-aborted request signal closes the stream immediately", async () => {
  const { streamRoute, db } = await importStream();
  const run = makeRun();
  db.insertRun(run);

  const abort = new AbortController();
  abort.abort();
  const res = await streamRoute.GET(
    streamRequest(run.id, { signal: abort.signal }),
    routeProps(run.id),
  );
  const { ended } = await collect(res, { timeoutMs: 2000 });
  assert.equal(ended, true, "pre-aborted signal must not leak an open stream");
});

// --- pure reconnect/backoff logic from the client hook (no DOM required) ---

test("computeBackoffDelay: exponential growth, jitter bounds, and cap", async () => {
  const { computeBackoffDelay, SSE_BACKOFF_BASE_MS, SSE_BACKOFF_MAX_MS } =
    await import("../lib/use-run-events");

  // Deterministic jitter extremes: random=0 → cap/2, random=1 → cap.
  assert.equal(computeBackoffDelay(0, () => 0), SSE_BACKOFF_BASE_MS / 2);
  assert.equal(computeBackoffDelay(0, () => 1), SSE_BACKOFF_BASE_MS);
  assert.equal(computeBackoffDelay(2, () => 0), (SSE_BACKOFF_BASE_MS * 4) / 2);
  assert.equal(computeBackoffDelay(2, () => 1), SSE_BACKOFF_BASE_MS * 4);

  // Monotone growth at fixed jitter until the cap.
  for (let a = 1; a < 5; a++) {
    assert.ok(
      computeBackoffDelay(a, () => 0.5) > computeBackoffDelay(a - 1, () => 0.5),
      `attempt ${a} backs off longer than ${a - 1}`,
    );
  }

  // Capped: huge attempt counts never exceed the max and never overflow.
  assert.equal(computeBackoffDelay(50, () => 1), SSE_BACKOFF_MAX_MS);
  assert.equal(computeBackoffDelay(1000, () => 1), SSE_BACKOFF_MAX_MS);

  // Negative attempts clamp to the first step.
  assert.equal(computeBackoffDelay(-3, () => 1), SSE_BACKOFF_BASE_MS);

  // Real jitter stays inside [cap/2, cap].
  for (let i = 0; i < 50; i++) {
    const d = computeBackoffDelay(3);
    assert.ok(d >= (SSE_BACKOFF_BASE_MS * 8) / 2 && d <= SSE_BACKOFF_BASE_MS * 8);
  }
});

test("buildStreamUrl: carries the resume cursor and encodes the run id", async () => {
  const { buildStreamUrl } = await import("../lib/use-run-events");
  assert.equal(buildStreamUrl("abc123"), "/api/runs/abc123/events/stream");
  assert.equal(buildStreamUrl("abc123", null), "/api/runs/abc123/events/stream");
  assert.equal(buildStreamUrl("abc123", 0), "/api/runs/abc123/events/stream");
  assert.equal(buildStreamUrl("abc123", 42), "/api/runs/abc123/events/stream?lastEventId=42");
  assert.equal(buildStreamUrl("abc123", 42.9), "/api/runs/abc123/events/stream?lastEventId=42");
  assert.equal(buildStreamUrl("abc123", NaN), "/api/runs/abc123/events/stream");
  assert.equal(buildStreamUrl("a/b"), "/api/runs/a%2Fb/events/stream");
});

test("shouldManualReconnect: only when the browser gave up (CLOSED)", async () => {
  const { shouldManualReconnect } = await import("../lib/use-run-events");
  assert.equal(shouldManualReconnect(0), false); // CONNECTING — auto-retry in flight
  assert.equal(shouldManualReconnect(1), false); // OPEN
  assert.equal(shouldManualReconnect(2), true);  // CLOSED — manual backoff takes over
});
