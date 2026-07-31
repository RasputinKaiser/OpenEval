import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/weekly-throughput.json", "utf8"));

function artifact() {
  assert.equal(existsSync("trend.svg"), true, "trend.svg is missing");
  return readFileSync("trend.svg", "utf8");
}

test("writes a self-contained, accessible SVG root", () => {
  const svg = artifact();
  assert.match(svg, /^<svg\b/i);
  assert.match(svg, /viewBox="0 0 720 360"/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-labelledby="chart-title chart-desc"/);
  assert.match(svg, /<title id="chart-title">Weekly throughput<\/title>/);
  assert.match(svg, /<desc id="chart-desc">/);
  assert.doesNotMatch(svg, /\b(?:href|xlink:href|src)=(["'])(?!#|data:)/i);
});

test("preserves every supplied label and value as inspectable data", () => {
  const svg = artifact();
  for (const record of data.records) {
    assert.match(svg, new RegExp(`data-label="${record.label}"`));
    assert.match(svg, new RegExp(`data-value="${record.value}"`));
  }
  assert.equal((svg.match(/data-bar=/g) ?? []).length, data.records.length);
});

test("declares the chart and data series for runtime evidence", () => {
  const svg = artifact();
  assert.match(svg, /data-testid="throughput-chart"/);
  assert.match(svg, /data-series="weekly-throughput"/);
  assert.match(svg, /<text[^>]*>40<\/text>/);
});
