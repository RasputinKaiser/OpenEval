import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("OutcomeChart keeps sparse data honest and the narrow plot operable", () => {
  const src = read("components/OutcomeChart.tsx");
  assert.match(src, /series\.length === 0/);
  assert.match(src, /One signal point is not enough to show a trend/);
  assert.match(src, /role="region"/);
  assert.match(src, /tabIndex=\{0\}/);
  assert.match(src, /const isOverflowing = W > containerW/);
  assert.match(src, /data-overflow=\{isOverflowing \? "true" : "false"\}/);
  assert.match(src, /Straight segments connect observed points; values between observations are not measured/);
  assert.match(src, /shownKinds\.indexOf\(kind\)/);
  assert.match(src, /No adoption markers in this range/);
  assert.match(src, /timeline-chart-mark/);
  assert.match(src, /child-only evidence is not a top-level outcome denominator/);
  assert.match(src, /mixed trace scopes/);
});

test("Timeline section navigation exposes responsive scroll state and active focus", () => {
  const src = read("components/mobile/ProgressiveSectionNav.tsx");
  assert.match(src, /data-can-scroll-left=\{scrollState\.left\}/);
  assert.match(src, /data-can-scroll-right=\{scrollState\.right\}/);
  assert.match(src, /addEventListener\("scroll", updateScrollState, \{ passive: true \}\)/);
  assert.match(src, /scrollIntoView\(\{ behavior: reduceMotion \? "auto" : "smooth"/);
  assert.match(src, /data-section-id=\{section\.id\}/);
  assert.match(src, /aria-current=\{activeSection === section\.id \? "page" : undefined\}/);
});

test("Timeline chart and comparison surfaces keep responsive styles scoped", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.timeline-section-nav/);
  assert.match(css, /\.timeline-chart-scroll/);
  assert.match(css, /section#impact \.data-table/);
  assert.match(css, /section#shifts \.data-table/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /scrollbar-gutter: stable/);
});

test("Timeline coalesces refreshes and makes the narrow Impact table operable", () => {
  const src = read("components/TimelineClient.tsx");
  assert.match(src, /const refreshInFlightRef = useRef<Promise<boolean> \| null>\(null\)/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return refreshInFlightRef\.current;/);
  assert.match(src, /if \(refreshInFlightRef\.current === request\) refreshInFlightRef\.current = null;/);
  assert.match(src, /role="region"/);
  assert.match(src, /tabIndex=\{0\}/);
  assert.match(src, /aria-label="Adoption comparison table\. Scroll horizontally to inspect all metrics\."/);
  assert.match(src, /aria-describedby="impact-scroll-hint"/);
  assert.match(src, /id="impact-scroll-hint"/);
  assert.match(src, /Swipe or shift-scroll to inspect all comparison metrics\./);
});
