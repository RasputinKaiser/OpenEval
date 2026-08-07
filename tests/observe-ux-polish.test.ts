import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { shouldShowOnboardingOverlay } from "../components/first-run-steps";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("observe section navigation explains the selected task and keeps targets touch-sized", () => {
  const nav = read("components/mobile/ProgressiveSectionNav.tsx");
  assert.match(nav, /description\?: string/);
  assert.match(nav, /Every section is visible as one continuous report/);
  assert.match(nav, /selectedSection\?\.description/);
  assert.match(nav, /min-h-10/);
  assert.match(nav, /timeline-section-nav__context/);

  for (const file of ["components/LiveClient.tsx", "components/CollectionClient.tsx", "components/TimelineClient.tsx"]) {
    assert.match(read(file), /description: "/, `${file} should explain each progressive section`);
  }
});

test("Collection opens in the full report and keeps a desktop return path", () => {
  const collection = read("components/CollectionClient.tsx");
  const nav = read("components/mobile/ProgressiveSectionNav.tsx");

  assert.match(collection, /useProgressiveSection\(sections, "all"\)/);
  assert.match(collection, /id: "all", label: "Full report", detail: "show every section"/);
  assert.match(nav, /initialSection: ProgressiveSectionId =/);
});

test("shared page headers reflow actions and retain readable titles", () => {
  const header = read("components/PageHeader.tsx");
  const css = read("app/globals.css");
  assert.match(header, /page-header-actions/);
  assert.match(header, /text-balance/);
  assert.doesNotMatch(header, /className="truncate"/);
  assert.match(css, /\.page-header-actions :is\(a, button, summary\)/);
  assert.match(css, /min-height: 40px/);
  assert.match(css, /@media \(max-width: 639px\)/);
});

test("judge readiness exposes recovery states instead of a dead disabled action", () => {
  const picker = read("components/JudgePicker.tsx");
  assert.match(picker, /readiness: "checking" \| "ready" \| "error" \| "unavailable"/);
  assert.match(picker, /setLoadState\("error"\)/);
  assert.match(picker, /data-judge-readiness=\{readiness\}/);
  assert.match(picker, /Retry judge readiness check/);
  assert.match(picker, /setReloadToken\(\(token\) => token \+ 1\)/);
  assert.match(picker, /statusLabel = readiness === "ready"/);
});

test("clean-install onboarding has one automatic surface but keeps replay behavior", () => {
  const overlay = read("components/OnboardingOverlay.tsx");
  const steps = read("components/first-run-steps.ts");
  assert.match(steps, /FIRST_RUN_GUIDE_SELECTOR/);
  assert.match(steps, /shouldShowOnboardingOverlay/);
  assert.equal(shouldShowOnboardingOverlay({ runCount: 0, parseableSessionCount: 0, inlineGuideVisible: true }), false);
  assert.equal(shouldShowOnboardingOverlay({ runCount: 0, parseableSessionCount: 0, inlineGuideVisible: false }), true);
  assert.match(overlay, /inlineFirstRunGuideVisible/);
  assert.match(overlay, /MutationObserver/);
  assert.match(overlay, /SHOW_ONBOARDING_EVENT/);
});

test("mobile analysis navigation and New Run keep the primary workflow close", () => {
  const nav = read("components/mobile/ProgressiveSectionNav.tsx");
  const newRun = read("components/NewRunClient.tsx");
  assert.match(nav, /md:sticky md:top-0 md:z-30/);
  assert.match(nav, /timeline-section-nav__context hidden .* md:flex/);
  assert.match(newRun, /new-run-summary-panel order-first space-y-4 lg:order-none/);
});

test("coverage caveats are grouped and review-method copy names the denominator", () => {
  const collection = read("components/CollectionClient.tsx");
  const live = read("components/LiveClient.tsx");
  const timeline = read("components/TimelineClient.tsx");
  assert.match(collection, /Collection coverage has caveats/);
  assert.match(collection, /data\.partial \|\| data\.inventoryPartial \|\| data\.coveragePartial/);
  assert.match(live, /Live scan notes/);
  assert.match(live, /Totals below describe only the parsed evidence in this slice/);
  assert.match(timeline, /Comparable scores/);
  assert.match(timeline, /Saved review records share one source, model, and prompt version/);
});

test("dashboard attention, stats, search, and session rows expose clear interaction feedback", () => {
  const dashboard = read("app/page.tsx");
  const sessions = read("components/RecentSessions.tsx");
  const css = read("app/globals.css");

  assert.match(dashboard, /LayoutDashboard/);
  assert.match(dashboard, /grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,18rem\),1fr\)\)\]/);
  assert.match(dashboard, /attention-card/);
  assert.match(dashboard, /interactive-card/);
  assert.match(sessions, /recent-session-row/);
  assert.match(sessions, /ArrowUpRight/);
  assert.match(css, /\.dashboard-search:focus-within/);
  assert.match(css, /\.recent-session-row:hover/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
});
