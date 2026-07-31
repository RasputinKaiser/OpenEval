import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
