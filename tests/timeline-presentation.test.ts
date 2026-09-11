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

test("Timeline judge controls keep source and model choices readable in the popover", () => {
  const timeline = read("components/TimelineClient.tsx");
  const picker = read("components/JudgePicker.tsx");
  const css = read("app/globals.css");
  assert.match(timeline, /timeline-judge-popover/);
  assert.match(timeline, /rounded-xl border border-bd bg-bg-subtle p-3 shadow-2xl/);
  assert.match(css, /\.timeline-judge-popover[\s\S]*width: min\(36rem, calc\(100vw - 1rem\)\)/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.timeline-judge-popover[\s\S]*width: min\(20rem, calc\(100vw - 1rem\)\)/);
  assert.match(picker, /sm:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.85fr\)\]/);
  assert.match(picker, /min-w-0 w-full rounded-md border border-bd bg-bg px-3 text-sm/);
  assert.match(picker, /spellCheck=\{false\}/);
  assert.match(picker, /w-full max-w-sm text-\[11px\]/);
});

test("Outcome timeline keeps the chart hierarchy and review receipt scannable", () => {
  const chart = read("components/OutcomeChart.tsx");
  const css = read("app/globals.css");
  const timeline = read("components/TimelineClient.tsx");
  assert.match(chart, /timeline-chart-toolbar-label/);
  // Range chip removed (0-1 bounded metric restates the scale); latest value lives on the
  // line's endpoint badge. Zoom brush + confidence-scaled segments are the new contract.
  assert.match(chart, /timeline-chart-latest-label/);
  assert.match(chart, /confidence|brush/i);
  assert.match(chart, /aria-label="Trend summary"/);
  assert.match(chart, /timeline-chart-legend-item--context/);
  assert.match(chart, /timeline-chart-series/);
  assert.match(css, /\.timeline-chart-toolbar \{/);
  assert.match(css, /\.timeline-chart-legend-item--context/);
  assert.match(timeline, /timeline-review-status/);
  assert.match(timeline, /aria-label="Review evidence counts"/);
  assert.match(timeline, /Comparable scores/);
  assert.match(timeline, /Saved review methods/);
  assert.match(timeline, /Source unavailable/);
  assert.match(timeline, /Model unavailable/);
  assert.match(timeline, /timeline-judge-result/);
  assert.match(timeline, /timeline-job-receipt/);
  assert.match(timeline, /Recovery detail:/);
  assert.match(css, /\.timeline-job-receipt__details/);
  assert.match(css, /\.timeline-job-receipt__state--warn/);
});

test("timeline formatting and chart guards survive malformed data (harden contract)", () => {
  const chart = read("components/OutcomeChart.tsx");
  // NaN-safe series filter must exist and every render-body use must read cleanSeries
  assert.match(chart, /const cleanSeries = series\.filter\(\(p\) => Number\.isFinite\(p\.value\) && Number\.isFinite\(p\.at\)\)/);
  assert.match(chart, /No readable outcome points in this snapshot/);
  assert.doesNotMatch(chart, /cx=\{x\(series\[/); // crosshair reads the cleaned series
  // shift + marker NaN guards
  assert.match(chart, /Number\.isFinite\(c\.at\) && Number\.isFinite\(c\.delta\)/);
  assert.match(chart, /Number\.isFinite\(m\.firstSeenAt\)/);
  // brush invalidates on series change
  assert.match(chart, /setBrush\(null\)/);
  const format = read("lib/format.ts");
  assert.match(format, /export function fmtInt/);
  assert.match(format, /Number\.isFinite\(x\) \? \(x >= 0 \? "\+" : ""\) \+ x\.toFixed\(digits\) : "—"/);
  assert.match(format, /typeof ms === "number" && Number\.isFinite\(ms\) \? new Date\(ms\)\.toISOString/);
  const timeline = read("components/TimelineClient.tsx");
  // popovers close on Escape (keyboard resilience)
  assert.match(timeline, /onKeyDown=\{\(e\) => \{ if \(e\.key === "Escape"\) e\.currentTarget\.open = false; \}\}/);
  assert.match(timeline, /fmtInt\(data\.totalSessions\)/);
});
