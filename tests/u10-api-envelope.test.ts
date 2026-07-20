import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RunRecord } from "../lib/types";

// Negative-input coverage for the shared { error, detail?, hint? } envelope
// (lib/api-http.ts): malformed query params must 400 (never 500), missing ids
// must 404, and every non-2xx JSON body must carry a string `error`.
//
// lib/config captures ROOT from process.cwd() at import time, so the cwd is
// redirected into a temp dir BEFORE any route module is imported (same pattern
// as tests/api-routes.test.ts — route imports are dynamic for that reason).
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-u10-envelope-"));
process.chdir(tempRoot);

after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function importRoutes() {
  const casesRoute = await import("../app/api/cases/route");
  const harnessesRoute = await import("../app/api/harnesses/route");
  const leaderboardRoute = await import("../app/api/harnesses/leaderboard/route");
  const liveRoute = await import("../app/api/live/route");
  const modelsRoute = await import("../app/api/models/route");
  const runDetailRoute = await import("../app/api/runs/[id]/route");
  const cancelRoute = await import("../app/api/runs/[id]/cancel/route");
  const reportRoute = await import("../app/api/runs/[id]/report/route");
  const telemetryRoute = await import("../app/api/runs/[id]/telemetry/route");
  const caseRoute = await import("../app/api/runs/[id]/case/[caseId]/route");
  const artifactRoute = await import("../app/api/runs/[id]/case/[caseId]/artifact/route");
  const settingsRoute = await import("../app/api/settings/route");
  const db = await import("../lib/db");
  return {
    casesRoute, harnessesRoute, leaderboardRoute, liveRoute, modelsRoute,
    runDetailRoute, cancelRoute, reportRoute, telemetryRoute, caseRoute,
    artifactRoute, settingsRoute, db,
  };
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function caseParams(id: string, caseId: string) {
  return { params: Promise.resolve({ id, caseId }) };
}

async function assertEnvelope(res: Response, status: number): Promise<{ error: string; detail?: string; hint?: string }> {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.equal(typeof body.error, "string", "envelope has a string `error`");
  for (const key of Object.keys(body)) {
    assert.ok(["error", "detail", "hint"].includes(key), `unexpected envelope key "${key}"`);
  }
  return body;
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: randomUUID().slice(0, 8),
    name: "envelope run",
    status: "completed",
    created_at: Date.now(),
    ended_at: Date.now(),
    params: { runner: "headless", parallel: 1 },
    summary: null,
    ...over,
  };
}

test("GET /api/cases ignores unknown query params and never 500s in an empty root", async () => {
  const { casesRoute } = await importRoutes();
  const res = await casesRoute.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.cases));
});

test("GET /api/harnesses: malformed refresh flag → 400 envelope", async () => {
  const { harnessesRoute } = await importRoutes();
  const res = await harnessesRoute.GET(new Request("http://localhost/api/harnesses?refresh=yes"));
  const body = await assertEnvelope(res, 400);
  assert.match(body.detail ?? "", /refresh/);
});

test("POST /api/harnesses: malformed JSON body → 400 envelope", async () => {
  const { harnessesRoute } = await importRoutes();
  const res = await harnessesRoute.POST(new Request("http://localhost/api/harnesses", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{nope",
  }));
  await assertEnvelope(res, 400);
});

test("POST /api/harnesses: missing/blank id → 400, unknown id → 404", async () => {
  const { harnessesRoute } = await importRoutes();
  const post = (body: unknown) => harnessesRoute.POST(new Request("http://localhost/api/harnesses", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  await assertEnvelope(await post({}), 400);
  await assertEnvelope(await post({ id: "   " }), 400);
  const missing = await assertEnvelope(await post({ id: "no-such-harness-xyz" }), 404);
  assert.match(missing.error, /unknown harness/i);
  assert.ok(missing.hint, "404 carries a hint pointing at GET /api/harnesses");
});

test("GET /api/harnesses/leaderboard: empty database → 200, not a fault", async () => {
  const { leaderboardRoute } = await importRoutes();
  const res = await leaderboardRoute.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.harnesses, []);
});

test("GET /api/live: non-numeric limit → 400 envelope, never a scan", async () => {
  const { liveRoute } = await importRoutes();
  const res = await liveRoute.GET(new Request("http://localhost/api/live?harness=totally-unknown&limit=abc"));
  const body = await assertEnvelope(res, 400);
  assert.match(body.detail ?? "", /limit/);
});

test("GET /api/live: out-of-range limit clamps (prior behavior) and unknown harness stays an honest 200", async () => {
  const { liveRoute } = await importRoutes();
  const res = await liveRoute.GET(new Request("http://localhost/api/live?harness=totally-unknown&limit=999999"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sourceHarness, "totally-unknown");
  assert.equal(body.sourceStatus, "unavailable");
  assert.equal(typeof body.sig, "string");
});

test("GET /api/models: empty harness param treated as absent → 200", async () => {
  const { modelsRoute } = await importRoutes();
  const res = await modelsRoute.GET(new Request("http://localhost/api/models?harness="));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.models));
  assert.equal(body.defaultModelSource, "none");
});

test("POST /api/models: malformed JSON and non-string id → 400 envelope", async () => {
  const { modelsRoute } = await importRoutes();
  const raw = await modelsRoute.POST(new Request("http://localhost/api/models", {
    method: "POST", headers: { "content-type": "application/json" }, body: "not json",
  }));
  await assertEnvelope(raw, 400);
  const numeric = await modelsRoute.POST(new Request("http://localhost/api/models", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 42 }),
  }));
  const body = await assertEnvelope(numeric, 400);
  assert.match(body.detail ?? "", /id/);
});

test("GET /api/runs/[id]: malformed lite flag → 400; unknown id → 404 envelope", async () => {
  const { runDetailRoute } = await importRoutes();
  const badFlag = await runDetailRoute.GET(
    new Request("http://localhost/api/runs/whatever?lite=true"),
    idParams("whatever"),
  );
  const flagBody = await assertEnvelope(badFlag, 400);
  assert.match(flagBody.detail ?? "", /lite/);

  const missing = await runDetailRoute.GET(
    new Request("http://localhost/api/runs/no-such-run"),
    idParams("no-such-run"),
  );
  const body = await assertEnvelope(missing, 404);
  assert.match(body.error, /not found/i);
});

test("POST /api/runs/[id]/cancel: unknown id → 404 envelope", async () => {
  const { cancelRoute } = await importRoutes();
  const res = await cancelRoute.POST(
    new Request("http://localhost/api/runs/no-such-run/cancel", { method: "POST" }),
    idParams("no-such-run"),
  );
  await assertEnvelope(res, 404);
});

test("GET /api/runs/[id]/report: malformed bundle flag → 400; unknown id → 404", async () => {
  const { reportRoute } = await importRoutes();
  const badFlag = await reportRoute.GET(
    new Request("http://localhost/api/runs/x/report?bundle=zip"),
    idParams("x"),
  );
  const flagBody = await assertEnvelope(badFlag, 400);
  assert.match(flagBody.detail ?? "", /bundle/);

  const missing = await reportRoute.GET(
    new Request("http://localhost/api/runs/no-such-run/report"),
    idParams("no-such-run"),
  );
  await assertEnvelope(missing, 404);
});

test("GET /api/runs/[id]/telemetry: unknown id → 404 envelope", async () => {
  const { telemetryRoute } = await importRoutes();
  const res = await telemetryRoute.GET(
    new Request("http://localhost/api/runs/no-such-run/telemetry"),
    idParams("no-such-run"),
  );
  await assertEnvelope(res, 404);
});

test("GET /api/runs/[id]/case/[caseId]: unknown run and unknown case both 404 with distinct detail", async () => {
  const { caseRoute, db } = await importRoutes();
  const missingRun = await caseRoute.GET(
    new Request("http://localhost/api/runs/no-such-run/case/c1"),
    caseParams("no-such-run", "c1"),
  );
  const runBody = await assertEnvelope(missingRun, 404);
  assert.match(runBody.error, /run not found/i);

  const run = makeRun();
  db.insertRun(run);
  const missingCase = await caseRoute.GET(
    new Request(`http://localhost/api/runs/${run.id}/case/nope`),
    caseParams(run.id, "nope"),
  );
  const caseBody = await assertEnvelope(missingCase, 404);
  assert.match(caseBody.error, /case not found/i);
});

test("GET artifact: missing path param → 400 envelope naming path", async () => {
  const { artifactRoute } = await importRoutes();
  const res = await artifactRoute.GET(
    new NextRequest("http://localhost/api/runs/r/case/c/artifact"),
    caseParams("r", "c"),
  );
  const body = await assertEnvelope(res, 400);
  assert.match(body.detail ?? "", /path/);
});

test("GET /api/settings returns settings without faulting in an empty root", async () => {
  const { settingsRoute } = await importRoutes();
  const res = await settingsRoute.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.settings);
  assert.ok(body.effectiveJudge);
});

test("PUT /api/settings: malformed JSON no longer silently resets settings → 400 envelope", async () => {
  const { settingsRoute } = await importRoutes();
  const res = await settingsRoute.PUT(new Request("http://localhost/api/settings", {
    method: "PUT", headers: { "content-type": "application/json" }, body: "{broken",
  }));
  await assertEnvelope(res, 400);
});

test("PUT /api/settings: over-length and unknown judge sources keep their specific top-level errors", async () => {
  const { settingsRoute } = await importRoutes();
  const put = (body: unknown) => settingsRoute.PUT(new Request("http://localhost/api/settings", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const tooLong = await assertEnvelope(await put({ judgeSource: "x".repeat(121) }), 400);
  assert.equal(tooLong.error, "Judge source is too long");
  const tooLongModel = await assertEnvelope(await put({ judgeModel: "x".repeat(241) }), 400);
  assert.equal(tooLongModel.error, "Judge model is too long");
  const unknown = await assertEnvelope(await put({ judgeSource: "definitely-not-a-harness" }), 400);
  assert.match(unknown.error, /unknown judge source/i);
  assert.ok(unknown.hint, "unknown source carries a hint");
});
