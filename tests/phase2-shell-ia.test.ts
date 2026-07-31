import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("mobile shell keeps primary destinations visible in a persistent safe-area nav", () => {
  const src = read("components/MobileNav.tsx");
  assert.match(src, /fixed inset-x-0 bottom-0/, "mobile nav must be persistent at the bottom");
  assert.match(src, /safe-area-inset-bottom/, "mobile nav must account for the device safe area");
  for (const label of ["Dashboard", "Live", "Runs"]) assert.match(src, new RegExp(`label: "${label}"`));
  assert.match(src, />More</, "the More action must be visibly labelled");
  assert.doesNotMatch(src, /fixed bottom-4 right-4/, "the old floating control must not return");
});

test("More is an accessible focus-trapped dialog with an explicit restore target", () => {
  const src = read("components/MobileNav.tsx");
  assert.match(src, /aria-haspopup="dialog"/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /aria-labelledby="mobile-more-title"/);
  assert.match(src, /useFocusTrap\(panelRef, open\)/);
  assert.match(src, /moreButtonRef/);
  assert.match(src, /openedRef/);
});

test("progressive section navigation restores hash/query state and exposes an All fallback", () => {
  const src = read("components/mobile/ProgressiveSectionNav.tsx");
  assert.match(src, /window\.location\.hash/);
  assert.match(src, /searchParams\.get\("section"\)/);
  assert.match(src, /searchParams\.set\("section"/);
  assert.match(src, /searchParams\.delete\("section"/);
  assert.match(src, /history\.replaceState/);
  assert.match(src, /addEventListener\("popstate"/);
  assert.match(src, /addEventListener\("hashchange"/);
  assert.match(src, /scrollIntoView/);
  assert.match(src, /if \(fromUrl !== "all"\) scrollSectionIntoView\(fromUrl\)/);
  assert.match(src, /requestAnimationFrame/);
  assert.match(src, />\s*All\s*</);
  assert.match(src, /aria-pressed=\{activeSection === "all"\}/);
  assert.doesNotMatch(src, /aria-controls=\{section\.id\}/, "focused sections are unmounted, so the nav must not expose broken control references");
  assert.match(src, /progressive-section-hidden/);
  assert.match(src, /observe-section/);
  assert.match(src, /prefers-reduced-motion/);
});

test("snapshot metadata remains visible instead of treating HTTP 200 as fresh", () => {
  const collection = read("components/CollectionClient.tsx");
  assert.match(collection, /setErr\(next\.refreshError\)/);
  assert.match(collection, /setErr\(page\.refreshError\)/);
  assert.match(collection, /if \(!data\.refreshing \|\| loading \|\| err\) return/);
  assert.match(collection, /window\.setTimeout/);
  assert.match(collection, /stale: page\.stale/);
  assert.match(collection, /refreshing: page\.refreshing/);
  assert.match(collection, /data\.stale \|\| data\.refreshing/);
  const timeline = read("components/TimelineClient.tsx");
  assert.match(timeline, /next\.stale \|\| next\.refreshing \|\| next\.refreshError/);
  assert.match(timeline, /next\.generatedAtMs \?\? Date\.now\(\)/);
  assert.match(
    timeline,
    /fetch\("\/api\/collection\/timeline\?fresh=1", \{ cache: "no-store" \}\)/,
    "automatic retries must bypass both browser and server-side stale-while-revalidate responses",
  );
  const timelinePage = read("app/collection/timeline/page.tsx");
  assert.match(timelinePage, /generatedAtMs: snapshot\.generatedAtMs/);
  assert.match(timelinePage, /stale: snapshot\.stale/);
  const snapshots = read("lib/collection/snapshot-service.ts");
  assert.match(snapshots, /collection\.refreshError \? \{ refreshError: collection\.refreshError \}/);
  assert.match(
    snapshots,
    /const generatedAtMs = Date\.now\(\);[\s\S]*aggregate: \{ \.\.\.aggregate, generatedAtMs \}/,
    "a completed rollup must own the snapshot freshness timestamp",
  );
  assert.match(
    snapshots,
    /ANALYTICS_SNAPSHOT_MAX_AGE_MS = 30_000/,
    "analytical navigation must not trigger a corpus rescan every five seconds",
  );
});

test("Collection and Timeline keep warnings/progress outside focused panels", () => {
  for (const relativePath of ["components/CollectionClient.tsx", "components/TimelineClient.tsx"]) {
    const src = read(relativePath);
    assert.match(src, /useProgressiveSection/);
    assert.match(src, /ProgressiveSectionNav/);
    assert.match(src, /isVisible\("[^"]+"\) && <section/);
  }
  const collection = read("components/CollectionClient.tsx");
  assert.ok(collection.indexOf("Scan budget expired") < collection.indexOf("<section id=\"overview\""));
  const timeline = read("components/TimelineClient.tsx");
  assert.ok(timeline.indexOf("Timeline evidence may be stale") < timeline.indexOf("<section id=\"overview\""));
  assert.match(timeline, /role="progressbar"/);
});

test("Timeline decision surface keeps provenance, denominators, and non-causal semantics visible", () => {
  const timeline = read("components/TimelineClient.tsx");
  assert.match(timeline, /How to read this page/);
  assert.match(timeline, /Evidence posture/);
  assert.match(timeline, /judgedSessions/);
  assert.match(timeline, /outcomeNBefore/);
  assert.match(timeline, /outcomePoolBefore/);
  assert.match(timeline, /thin evidence/);
  assert.match(timeline, /<details/);
  assert.match(timeline, /scope="row"/);
  assert.match(timeline, /<caption className="sr-only">Adoption comparison table/);
  assert.match(timeline, /Nearby markers \(not attribution\)/);
  assert.doesNotMatch(timeline, /Possible cause/);
});

test("Timeline action and loading contracts keep refresh, judge work, and fallback states explicit", () => {
  const timeline = read("components/TimelineClient.tsx");
  const loading = read("app/collection/timeline/loading.tsx");
  const error = read("app/collection/timeline/error.tsx");
  assert.match(timeline, /aria-label="Timeline actions"/);
  assert.match(timeline, /<details className="relative">/);
  assert.match(timeline, /preserve the current report while it loads/);
  assert.match(timeline, /The current report remains visible/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading Timeline and Impact evidence/);
  assert.match(error, /Timeline evidence unavailable/);
});
