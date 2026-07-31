import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SnapshotService } from "../lib/collection/snapshot-service";
import { _clearSnapshotServicesForTest } from "../lib/collection/snapshot-service";
import { _setCollectionHooksForTest } from "../lib/collection/aggregate";
import { collectSourceFiles } from "../lib/live";
import { defToSpec, type CollectionSourceDef } from "../lib/collection/sources";
import type { DiscoveredSource } from "../lib/collection/discover";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const timelineCorpus = fs.mkdtempSync(path.join(process.cwd(), ".test-timeline-snapshot-"));
const timelineSource: CollectionSourceDef = {
  id: "phase2-timeline-source",
  label: "Phase 2 Timeline Source",
  roots: [timelineCorpus],
  format: "jsonl-dir",
  parseable: true,
};

function writeTimelineSession(id: string, iso: string): void {
  const file = path.join(timelineCorpus, `${id}.jsonl`);
  fs.writeFileSync(file, [
    { type: "system", sessionId: id, cwd: "/tmp/phase2", timestamp: iso },
    { type: "assistant", timestamp: iso, message: { content: [{ type: "text", text: `done ${id}` }] } },
    { type: "result", timestamp: iso, duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } },
  ].map((line) => JSON.stringify(line)).join("\n"), "utf8");
  fs.utimesSync(file, new Date(iso), new Date(iso));
}

function timelineHooks() {
  const discover = (): DiscoveredSource[] => {
    const collected = collectSourceFiles(defToSpec(timelineSource));
    let lastActivityMs: number | null = null;
    for (const file of collected.files) {
      if (lastActivityMs == null || file.mtime > lastActivityMs) lastActivityMs = file.mtime;
    }
    return [{
      id: timelineSource.id,
      label: timelineSource.label,
      format: timelineSource.format,
      parseable: true,
      roots: timelineSource.roots,
      presentRoots: timelineSource.roots,
      sessionCount: collected.files.length,
      lastActivityMs,
      status: collected.files.length > 0 ? "present" : "empty",
      collected,
    }];
  };
  return { discover, sources: () => [timelineSource], unknown: () => [], fingerprintTtlMs: 60_000, unknownTtlMs: 0 };
}

test("concurrent stale reads coalesce into one refresh", async () => {
  let now = 0;
  let calls = 0;
  let release!: () => void;
  let gate = new Promise<void>((resolve) => { release = resolve; });
  const service = new SnapshotService<string>({
    maxAgeMs: 10,
    now: () => now,
    load: async () => {
      calls++;
      await gate;
      return { value: `snapshot-${calls}`, generatedAtMs: now };
    },
  });

  const a = service.get();
  const b = service.get();
  await tick();
  assert.equal(calls, 1, "only one initial load should run");
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.value, "snapshot-1");
  assert.equal(second.value, "snapshot-1");

  now = 11;
  gate = new Promise<void>((resolve) => { release = resolve; });
  const staleA = await service.get();
  const staleB = await service.get();
  assert.equal(staleA.value, "snapshot-1");
  assert.equal(staleB.value, "snapshot-1");
  assert.equal(staleA.stale, true);
  assert.equal(staleA.refreshing, true);
  assert.equal(calls, 2, "the stale pair must share one refresh");
  release();
  const refreshed = await service.get({ waitForRefresh: true });
  assert.equal(refreshed.value, "snapshot-2");
});

test("refresh failure keeps the atomic last-good value and reports the error", async () => {
  let now = 0;
  let fail = false;
  let calls = 0;
  const service = new SnapshotService<string>({
    maxAgeMs: 10,
    now: () => now,
    load: () => {
      calls++;
      if (fail) throw new Error("refresh unavailable");
      return { value: "last-good", generatedAtMs: now };
    },
  });

  const good = await service.get();
  assert.equal(good.value, "last-good");
  now = 11;
  fail = true;
  const stale = await service.get();
  assert.equal(stale.value, "last-good");
  assert.equal(stale.generatedAtMs, 0);
  assert.equal(stale.stale, true);
  assert.equal(stale.refreshing, true);
  await tick();

  const failed = await service.get({ forceRefresh: true, waitForRefresh: true });
  assert.equal(failed.value, "last-good");
  assert.equal(failed.generatedAtMs, 0, "a failed refresh must not restamp freshness");
  assert.equal(failed.stale, true);
  assert.equal(failed.refreshing, false);
  assert.equal(failed.refreshError, "refresh unavailable");
  assert.equal(calls, 3, "the background refresh and explicit retry are distinct attempts");

  const backedOff = await service.get();
  assert.equal(backedOff.stale, true, "failed-refresh backoff must not relabel last-good data as fresh");
  assert.equal(backedOff.refreshing, false);
  assert.equal(backedOff.refreshError, "refresh unavailable");
  assert.equal(calls, 3, "ordinary reads respect failure backoff");
});

test("serving a warm snapshot never fakes a new generatedAt timestamp", async () => {
  let now = 100;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = new SnapshotService<string>({
    maxAgeMs: 20,
    now: () => now,
    load: async () => {
      calls++;
      if (calls > 1) await gate;
      return { value: calls === 1 ? "v1" : "v2", generatedAtMs: now };
    },
  });

  const first = await service.get();
  now = 110;
  const warm = await service.get();
  assert.equal(warm.value, "v1");
  assert.equal(warm.generatedAtMs, first.generatedAtMs);
  assert.equal(warm.stale, false);

  now = 121;
  const stale = await service.get();
  assert.equal(stale.value, "v1");
  assert.equal(stale.generatedAtMs, 100);
  assert.equal(stale.stale, true);
  assert.equal(stale.refreshing, true);
  release();
  const refreshed = await service.get({ waitForRefresh: true });
  assert.equal(refreshed.value, "v2");
  assert.equal(refreshed.generatedAtMs, 121);
  assert.equal(refreshed.stale, false);
});

test("a one-shot bounded loader does not coalesce into an unrelated refresh", async () => {
  let now = 0;
  let defaultCalls = 0;
  let boundedCalls = 0;
  let release!: () => void;
  let blockDefault = false;
  const service = new SnapshotService<string>({
    maxAgeMs: 10,
    now: () => now,
    load: async () => {
      defaultCalls++;
      if (blockDefault) await new Promise<void>((resolve) => { release = resolve; });
      return { value: `default-${defaultCalls}`, generatedAtMs: now };
    },
  });

  await service.get();
  now = 11;
  blockDefault = true;
  const stale = await service.get();
  assert.equal(stale.refreshing, true);

  const bounded = await service.get({
    forceRefresh: true,
    waitForRefresh: true,
    loader: () => {
      boundedCalls++;
      return { value: "bounded", generatedAtMs: now, cacheable: false };
    },
  });
  assert.equal(boundedCalls, 1, "the caller-specific loader must execute");
  assert.equal(bounded.value, "bounded");
  assert.equal(bounded.stale, true, "a non-cacheable bounded result is explicitly transient");
  release();
  await tick();
  assert.equal(defaultCalls, 2);
});

test("clearing a snapshot cannot let an old in-flight refresh repopulate state", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = new SnapshotService<string>({
    load: async () => {
      calls++;
      if (calls === 1) await gate;
      return { value: `snapshot-${calls}`, generatedAtMs: calls };
    },
  });

  const oldRefresh = service.get();
  await tick();
  assert.equal(calls, 1);
  service.clear();
  release();
  const invalidated = await oldRefresh;
  assert.equal(invalidated.value, "snapshot-1");
  assert.equal(invalidated.evidence.partial, true);
  assert.equal(invalidated.evidence.state, "partial");

  const fresh = await service.get();
  assert.equal(fresh.value, "snapshot-2");
  assert.equal(calls, 2, "the cleared service must perform a new load");
});

test("Collection page keeps the initial session render bounded", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "app/collection/page.tsx"), "utf8");
  assert.match(page, /INITIAL_COLLECTION_SESSION_LIMIT = 80/);
  assert.match(page, /aggregate\.sessions\.slice\(0, INITIAL_COLLECTION_SESSION_LIMIT\)/);
});

test("Timeline judge refresh bypasses the server-side report cache", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/collection/timeline/route.ts"), "utf8");
  const client = fs.readFileSync(path.join(process.cwd(), "components/TimelineClient.tsx"), "utf8");
  assert.match(route, /searchParams\.get\("fresh"\) === "1"/);
  assert.match(route, /getTimelineSnapshot\(\{ forceRefresh \}\)/);
  assert.match(client, /\/api\/collection\/timeline\?fresh=1/);
});

test("fresh Timeline API refresh awaits a fresh Collection dependency and disables HTTP caching", async () => {
  _clearSnapshotServicesForTest();
  _setCollectionHooksForTest(timelineHooks());
  try {
    writeTimelineSession("timeline-a", "2026-07-28T12:00:00.000Z");
    const route = await import("../app/api/collection/timeline/route");
    const first = await route.GET(new Request("http://localhost/api/collection/timeline?fresh=1"));
    assert.equal(first.status, 200);
    assert.match(first.headers.get("cache-control") ?? "", /private, no-store/);
    assert.equal((await first.json()).totalSessions, 1);

    writeTimelineSession("timeline-b", "2026-07-28T12:01:00.000Z");
    const forced = await route.GET(new Request("http://localhost/api/collection/timeline?fresh=1"));
    assert.equal(forced.status, 200);
    assert.equal((await forced.json()).totalSessions, 2, "fresh must bypass both Timeline and Collection snapshots");
  } finally {
    _clearSnapshotServicesForTest();
    _setCollectionHooksForTest(null);
    fs.rmSync(timelineCorpus, { recursive: true, force: true });
  }
});
