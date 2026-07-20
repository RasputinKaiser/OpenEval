import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * U08 — loading / not-found / error state sweep.
 *
 * These are structural contracts, not render tests: every heavy route must
 * ship a layout-mirroring loading.tsx (so server-component fetches stream a
 * skeleton instead of a blank page), id-bearing routes must ship not-found.tsx
 * (so bogus ids get a 404 surface, not the generic error boundary), and the
 * shared error boundary must expose the copy-diagnostics affordance.
 */

const REPO_ROOT = path.join(__dirname, "..");
const APP = path.join(REPO_ROOT, "app");

const read = (...segs: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...segs), "utf8");

// Every route that fetches server-side before first paint.
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
];

test("loading.tsx exists for every heavy route", () => {
  for (const route of LOADING_ROUTES) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, route, "loading.tsx")),
      `${route}/loading.tsx missing — heavy routes must stream a skeleton`
    );
  }
});

test("loading skeletons are real layouts, not spinner-only screens", () => {
  for (const route of LOADING_ROUTES) {
    const src = read(route, "loading.tsx");
    assert.match(src, /shimmer/, `${route}/loading.tsx should use the shared shimmer skeleton class`);
    assert.match(src, /aria-busy/, `${route}/loading.tsx should mark the region aria-busy for assistive tech`);
    assert.doesNotMatch(src, /animate-spin/, `${route}/loading.tsx must not be a spinner-only screen`);
  }
});

test("not-found surfaces exist for id-bearing routes and the app root", () => {
  const notFounds = [
    "app/not-found.tsx",
    "app/runs/[id]/not-found.tsx",
    "app/runs/[id]/case/[caseId]/not-found.tsx",
  ];
  for (const file of notFounds) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} missing`);
    const src = read(file);
    assert.match(src, /<Link/, `${file} must link back to a listing, not dead-end`);
  }
});

test("id-bearing pages call notFound() so misses reach the 404 surface", () => {
  for (const page of ["app/runs/[id]/page.tsx", "app/runs/[id]/case/[caseId]/page.tsx", "app/runs/[id]/bench/page.tsx"]) {
    const src = read(page);
    assert.match(src, /notFound\(\)/, `${page} must route id misses to notFound(), not throw`);
  }
});

test("every route error boundary delegates to the shared ErrorBoundaryClient", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name === "error.tsx" ? [p] : [];
    });
  const errorFiles = walk(APP);
  assert.ok(errorFiles.length >= 8, `expected route error boundaries, found ${errorFiles.length}`);
  for (const file of errorFiles) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /ErrorBoundaryClient/, `${file} should delegate to the shared boundary`);
    assert.match(src, /^"use client";/, `${file} must be a client component`);
  }
});

test("ErrorBoundaryClient offers copy-diagnostics with digest + route", () => {
  const src = read("components", "ErrorBoundaryClient.tsx");
  assert.match(src, /Copy diagnostic details/, "copy affordance label missing");
  assert.match(src, /usePathname/, "diagnostics must include the current route");
  assert.match(src, /error\.digest/, "diagnostics must include the error digest");
  assert.match(src, /clipboard\.writeText/, "diagnostics must be copied to the clipboard");
  assert.match(src, /catch/, "clipboard failures must not crash the error surface");
});

test("EmptyState supports a concrete next action and CLI secondary", () => {
  const src = read("components", "EmptyState.tsx");
  assert.match(src, /actionHref/, "EmptyState must support a primary action link");
  assert.match(src, /command/, "EmptyState must support a CLI one-liner secondary action");
});
