import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");

function read(relativePath: string): string {
  const absolutePath = path.join(ROOT, relativePath);
  assert.ok(fs.existsSync(absolutePath), `${relativePath} must exist for the evaluation-lab contract`);
  return fs.readFileSync(absolutePath, "utf8");
}

test("Compare mounts EvaluateNav and exposes visual comparison plus outcome/profile visualizations", () => {
  const compare = read("components/CompareClient.tsx");

  assert.match(compare, /import EvaluateNav/);
  assert.match(compare, /<EvaluateNav\s*\/>/);
  assert.match(compare, /VisualComparisonStage/);
  assert.match(compare, /\boutcome\b/i, "Compare must expose outcome evidence");
  assert.match(compare, /\bprofile\b/i, "Compare must expose profile evidence");
  assert.match(
    compare,
    /(?:OutcomeProfile|OutcomeChart|ProfileChart|RunProfile|<svg\b|role="img"|aria-label="[^"]*(?:outcome|profile))/i,
    "Compare must render an outcome/profile visualization",
  );
});

test("RunDetailClient mounts a watchable evaluation stage", () => {
  const runDetail = read("components/RunDetailClient.tsx");
  const watch = read("components/RunWatch.tsx");
  const events = read("lib/use-run-events.ts");

  assert.match(runDetail, /<RunWatch\b/);
  assert.match(
    runDetail,
    /<RunWatch\b[\s\S]{0,700}(?:streamStatus|events|live)/,
    "the watch stage must receive live connection and event state",
  );
  assert.match(watch, /data-testid="run-watch-mode"/);
  assert.match(watch, /Recent activity/);
  assert.match(watch, /Now running|Up next/);
  assert.match(watch, /not a visual verdict|visual/i);
  assert.match(events, /events: RunEvent\[\]/);
  assert.match(events, /case_error/);
});

test("VisualComparisonStage uses the sandboxed ArtifactPreview and keeps artifact evidence boundaries explicit", () => {
  const stage = read("components/VisualComparisonStage.tsx");
  const preview = read("components/ArtifactPreview.tsx");

  assert.match(stage, /import\s+ArtifactPreview/);
  assert.match(stage, /<ArtifactPreview\b/);
  assert.match(preview, /<iframe[\s\S]*sandbox=""/);
  assert.match(stage, /(?:missing artifact|artifact[^\n]*(?:missing|not observed|not available)|expected artifact[^\n]*(?:missing|not observed|not available))/i);
  assert.match(stage, /(?:byte receipt|\bbytes\b|sha256)/i);
  assert.match(
    stage,
    /(?:visual (?:quality|verdict)[^\n]*(?:not|unavailable)|not automatically verified|not a visual verdict)/i,
    "artifact bytes must not be presented as a visual verdict",
  );
});

test("Evaluate retains the Compare route", () => {
  const evaluateNav = read("components/EvaluateNav.tsx");
  const comparePage = read("app/runs/compare/page.tsx");

  assert.match(evaluateNav, /href: "\/runs\/compare"/);
  assert.match(evaluateNav, /label: "Compare"/);
  assert.match(comparePage, /CompareClient/);
  assert.match(comparePage, /return\s+<CompareClient\b/);
});
