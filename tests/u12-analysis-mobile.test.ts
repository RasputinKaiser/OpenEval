import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fmtNum, fmtNumFull, fmtUsd, fmtDuration, fmtPct } from "../lib/format";

/**
 * U12 — analysis surfaces polish (Collection, Timeline, Compare, Leaderboard).
 *
 * Two layers:
 *  1. Behavior coverage for the lib/format outputs those four clients now
 *     route ALL numbers through (regressions here silently re-introduce raw
 *     floats in the UI).
 *  2. Source contracts on the client components for the mobile/affordance
 *     invariants that have no DOM harness in this repo: horizontally
 *     scrollable tables, sticky first columns, tap-to-pin tooltips, debounced
 *     URL-preserved Collection search, and Timeline's URL-persisted marker
 *     filter. These are grep-level checks by design — they pin the contract,
 *     not the styling.
 */

const REPO_ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

// ---- 1. formatter behavior the four clients rely on ----

test("fmtPct formats ratios and never renders non-finite values", () => {
  assert.equal(fmtPct(0.856), "86%");
  assert.equal(fmtPct(0), "0%");
  assert.equal(fmtPct(1), "100%");
  assert.equal(fmtPct(NaN), "—");
  assert.equal(fmtPct(Infinity), "—");
});

test("fmtUsd keeps sub-dollar eval costs readable (4 decimals) and compacts large ones", () => {
  assert.equal(fmtUsd(0.0234), "$0.0234");
  assert.equal(fmtUsd(3.5), "$3.50");
  assert.equal(fmtUsd(12_500), "$12.5k");
  assert.equal(fmtUsd(NaN), "—");
});

test("fmtNum/fmtNumFull compact token totals with the exact value available", () => {
  assert.equal(fmtNum(1_234_567), "1.2M");
  assert.equal(fmtNumFull(1_234_567), (1_234_567).toLocaleString());
  assert.equal(fmtNum(NaN), "—");
});

test("fmtDuration covers the leaderboard's ms→hours range", () => {
  assert.equal(fmtDuration(450), "450ms");
  assert.equal(fmtDuration(9_500), "9.5s");
  assert.equal(fmtDuration(150_000), "2m 30s");
  assert.equal(fmtDuration(0), "—");
});

// ---- 2. source contracts on the owned clients ----

test("Compare and Leaderboard route numbers through lib/format (no ad-hoc locale formatting)", () => {
  for (const rel of ["components/CompareClient.tsx", "components/LeaderboardClient.tsx"]) {
    const src = read(rel);
    assert.match(src, /from "@\/lib\/format"/, `${rel} must import lib/format`);
    assert.doesNotMatch(src, /toLocaleString\(\)/, `${rel} must not hand-format numbers with toLocaleString`);
  }
});

test("all four analysis tables stay horizontally scrollable with a sticky identity column", () => {
  for (const rel of [
    "components/CollectionClient.tsx",
    "components/TimelineClient.tsx",
    "components/CompareClient.tsx",
    "components/LeaderboardClient.tsx",
  ]) {
    const src = read(rel);
    assert.match(src, /overflow-x-auto/, `${rel} must wrap wide tables in overflow-x-auto`);
    assert.match(src, /sticky left-0/, `${rel} must pin a sticky identity column for narrow viewports`);
  }
});

test("chart tooltips support pinning (touch/keyboard) and Escape/outside dismissal", () => {
  const tooltip = read("components/ChartTooltip.tsx");
  assert.match(tooltip, /togglePin/, "useChartTooltip must expose togglePin");
  assert.match(tooltip, /Escape/, "pinned tips must dismiss on Escape");
  assert.match(tooltip, /pinKey/, "TipState must carry the pinning mark's identity");
  for (const rel of ["components/CollectionCharts.tsx", "components/OutcomeChart.tsx"]) {
    const src = read(rel);
    assert.match(src, /togglePin\(/, `${rel} marks must offer tap-to-pin`);
    assert.match(src, /onFocus=/, `${rel} marks must show tips on keyboard focus`);
  }
});

test("Collection search debounces, reports counts, and preserves ?q= in the URL", () => {
  const src = read("components/CollectionClient.tsx");
  assert.match(src, /SEARCH_DEBOUNCE_MS/, "search must be debounced");
  assert.match(src, /searchParams\.set\("q"/, "the query must be mirrored into ?q=");
  assert.match(src, /history\.replaceState/, "URL sync must not trigger a Next navigation");
  assert.match(src, /First \$\{hits\.length\} results/, "capped result counts must be surfaced");
  assert.match(src, /\$\{hits\.length\} result\$\{hits\.length === 1 \? "" : "s"\}/, "exact result counts must be surfaced");
});

test("Collection load-more keeps cursor pagination semantics (no limit-growth refetch regression)", () => {
  const src = read("components/CollectionClient.tsx");
  assert.match(src, /cursor=\$\{encodeURIComponent\(nextCursor\)\}/, "pages must continue from the cursor");
  assert.match(src, /nextCursor === null/, "explicit null must mean exhausted");
  assert.match(src, /s\.path \?\? s\.sessionId/, "dedupe must key on path ?? sessionId");
});

test("Timeline marker filter persists its state in the URL", () => {
  const src = read("components/TimelineClient.tsx");
  assert.match(src, /searchParams\.set\("kind"/, "the active kind must be mirrored into ?kind=");
  assert.match(src, /searchParams\.delete\("kind"/, "the 'all' state must clear ?kind=");
  assert.match(src, /get\("kind"\)/, "the filter must initialize from the URL");
  assert.match(src, /aria-pressed/, "filter pills must expose toggle state");
});

test("Compare explains its empty and one-run states", () => {
  const src = read("components/CompareClient.tsx");
  assert.match(src, /runs\.length === 0/, "zero-run state must exist");
  assert.match(src, /runs\.length === 1/, "one-run state must exist");
  assert.match(src, /runs\.length >= 2 && \(!a \|\| !b\)/, "unselected state must explain what to pick");
  assert.match(src, /\.catch\(/, "diff fetches must never surface a runtime overlay");
});
