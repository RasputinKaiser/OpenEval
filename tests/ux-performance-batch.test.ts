import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("shared System navigation uses emitted CSS-variable colors and visible interaction states", () => {
  const src = read("components/SystemNav.tsx");
  const css = read("app/globals.css");
  assert.match(src, /system-nav__item--active/);
  assert.match(css, /\.system-nav__item--active[\s\S]*color-mix\(in srgb, var\(--color-accent\)/);
  assert.match(src, /focus-visible:ring-2/);
  assert.match(src, /active:scale-\[0\.98\]/);
  assert.doesNotMatch(src, /bg-accent\/10|ring-accent\/30/);
});

test("shared styles avoid unbounded transitions", () => {
  const css = read("app/globals.css");
  assert.doesNotMatch(css, /transition:\s*all\b/);
});

test("Live polling coalesces identical scans and reuses the projected JSON", () => {
  const route = read("app/api/live/route.ts");
  assert.match(route, /liveScanInFlight/);
  assert.match(route, /coalescedLiveScan\(limit, harness\)/);
  assert.match(route, /serializeLiveProjection\(projected\)/);
  assert.match(route, /serializedJsonResponse\(/);
});

test("shared route recovery is redacted, accessible, and retry-gated", () => {
  const boundary = read("components/ErrorBoundaryClient.tsx");
  assert.match(boundary, /redactSensitiveText/);
  assert.match(boundary, /role=\"alert\"/);
  assert.match(boundary, /retryingRef/);
  assert.match(boundary, /aria-busy=\{retrying\}/);
  for (const file of ["app/accuracy/loading.tsx", "app/collection/timeline/loading.tsx"]) {
    const loading = read(file);
    assert.match(loading, /role=\"status\"/);
    assert.match(loading, /aria-busy=\"true\"/);
    assert.match(loading, /sr-only/);
  }
});
