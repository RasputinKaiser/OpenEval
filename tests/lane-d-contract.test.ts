import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const LOADING_ROUTES = [
  "app",
  "app/runs",
  "app/runs/[id]",
  "app/runs/[id]/case/[caseId]",
  "app/collection",
  "app/collection/session",
  "app/collection/timeline",
  "app/live",
  "app/cases",
  "app/accuracy",
  "app/harnesses",
  "app/settings",
];

test("loading states announce progress without exposing decorative skeletons", () => {
  for (const route of LOADING_ROUTES) {
    const source = read(`${route}/loading.tsx`);
    assert.match(source, /role="status"/i, `${route} must expose a status region`);
    assert.match(source, /aria-live="polite"/i, `${route} must announce loading progress politely`);
    assert.match(source, /sr-only/, `${route} must contain a short screen-reader loading message`);
    assert.match(source, /aria-hidden="true"/, `${route} skeleton bars must be decorative`);
  }
});

test("command palette keeps its modal labelled, closable, and selection index bounded", () => {
  const source = read("components/CommandPalette.tsx");
  assert.match(source, /aria-labelledby="command-palette-title"/);
  assert.match(source, /id="command-palette-title"/);
  assert.match(source, /aria-label="Close command palette"/);
  assert.match(source, /highlightedIdx/);
  assert.match(source, /if \(ordered\.length === 0\) return/);
  assert.match(source, /focus-visible:ring-2/);
});

test("mobile navigation exposes the sheet relationship and keyboard focus states", () => {
  const source = read("components/MobileNav.tsx");
  assert.match(source, /aria-controls="mobile-more-panel"/);
  assert.match(source, /id="mobile-more-panel"/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /Close More navigation/);
});

test("route recovery resets its retry guard for a fresh error and cleans timers", () => {
  const source = read("components/ErrorBoundaryClient.tsx");
  assert.match(source, /useEffect/);
  assert.match(source, /retryingRef\.current = false/);
  assert.match(source, /\[error, pathname\]/);
  assert.match(source, /copyTimerRef/);
  assert.match(source, /type="button"/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /redactSecrets/);
  assert.match(source, /safeErrorMessage/);
});

test("empty states announce the result, hide decorative icons, and contain long commands", () => {
  const source = read("components/EmptyState.tsx");
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /<Icon aria-hidden="true"/);
  assert.match(source, /max-w-full overflow-x-auto break-all/);
  assert.match(source, /focus-visible:ring-2/);
});

test("accuracy search includes actionable evidence gaps and has an empty-corpus action", () => {
  const source = read("components/AccuracyClient.tsx");
  assert.match(source, /\.\.\.row\.weaknesses/);
  assert.match(source, /\.\.\.row\.uncertainties/);
  assert.match(source, /No accuracy cases are available yet/);
  assert.match(source, /Open case library/);
  assert.match(source, /emptyCorpus/);
  assert.match(source, /configuration only/);
});

test("settings loading is retryable, uncached, and abort-aware", () => {
  const source = read("components/SettingsClient.tsx");
  assert.match(source, /loadAttempt/);
  assert.match(source, /Retry loading settings/);
  assert.match(source, /cache: "no-store", signal/);
  assert.match(source, /loadMaintenance\(controller\.signal\)/);
  assert.match(source, /signal\?\.aborted/);
  assert.match(source, /maintenanceRequestRef/);
  assert.match(source, /judgeSnapshot/);
  assert.match(source, /settingsSnapshot/);
  assert.match(source, /disabled=\{Boolean\(maintenanceBusy\)\}/);
  assert.match(source, /focus-visible:ring-2/);
});

test("settings has a route-level recovery surface", () => {
  assert.match(read("app/settings/loading.tsx"), /role="status"/);
  assert.match(read("app/settings/loading.tsx"), /aria-busy="true"/);
  assert.match(read("app/settings/loading.tsx"), /sr-only/);
  assert.match(read("app/settings/error.tsx"), /Settings failed to load/);
  assert.match(read("app/settings/error.tsx"), /ErrorBoundaryClient/);
});

test("mutating requests validate an explicit Origin even with Sec-Fetch-Site none", async () => {
  const request = new NextRequest("http://localhost:3000/api/settings", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "sec-fetch-site": "none",
      origin: "https://attacker.example",
    },
  });
  const response = middleware(request);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "cross-origin request rejected" });
});
