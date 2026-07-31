import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("benchmark surfaces keep explicit units and give charts honest empty states", () => {
  const bench = read("components/BenchClient.tsx");
  assert.match(bench, /No benchmark telemetry yet/);
  assert.match(bench, /No plottable token and cost evidence/);
  assert.match(bench, /No measured throughput evidence/);
  assert.match(bench, /durationSource === "runner_wall" && c\.tokenSource === "cli_usage"/);
  assert.match(bench, /Horizontal axis: total tokens \(input \+ output\)/);
  assert.match(bench, /Horizontal scale: output tokens per runner wall-clock second/);
  assert.match(bench, /const hasTelemetry = Boolean\(t\?\.perCase\.length\)/);
  assert.match(bench, /type="button"/);
  assert.match(bench, /aria-sort=\{sortAria\(/);
  assert.match(bench, /c\.tokenSource === "cli_usage" \? c\.tokensPerCase/);
});

test("compare never turns missing metrics into zero deltas or stale pair evidence", () => {
  const compare = read("components/CompareClient.tsx");
  assert.match(compare, /setRows\(\[\]\);\s*setSummaryA\(null\);\s*setSummaryB\(null\);/);
  assert.match(compare, /function outputRate\(caseData: any\): number \| null/);
  assert.match(compare, /function MetricDelta\(/);
  assert.match(compare, /Not comparable: \$\{label\} evidence is missing/);
  assert.match(compare, /Output tok\/s Δ/);
  assert.match(compare, /Estimated cost \(USD\) Δ/);
  assert.match(compare, /<caption className="sr-only">Per-case comparison/);
  assert.match(compare, /Open \$\{caseName\} in \$\{side\}/);
  assert.match(compare, /aCaseRef: string \| null; bCaseRef: string \| null/);
  assert.match(compare, /r\.bCaseRef \? b : a/);
  assert.match(compare, /caseId=\{r\.aCaseRef \?\? r\.caseId\}/);
});

test("leaderboard evidence exposes denominator, units, and sort state to assistive technology", () => {
  const leaderboard = read("components/LeaderboardClient.tsx");
  assert.match(leaderboard, /<caption className="sr-only">Harness leaderboard/);
  assert.match(leaderboard, /Cost \(USD\)/);
  assert.match(leaderboard, /Tokens \(in \/ out\)/);
  assert.match(leaderboard, /Avg output tok\/s/);
  assert.match(leaderboard, /aria-sort=\{sortKey === "passRate"/);
  assert.match(leaderboard, /aria-label=\{`\$\{label\}/);
  assert.match(leaderboard, /role="img" aria-label=\{`\$\{r\.harness\}: \$\{fmtPct\(r\.passRate\)\} pass rate/);
  assert.match(leaderboard, /function boundedPercent\(/);
  assert.match(leaderboard, /type="button"/);
});

test("run detail keeps empty states and visual-quality boundaries explicit", () => {
  const watch = read("components/RunWatch.tsx");
  const cases = read("components/run-detail/CaseListPanel.tsx");
  const collapsible = read("components/run-detail/CollapsibleCard.tsx");
  const artifact = read("components/run-detail/ArtifactSection.tsx");
  const casePanel = read("components/run-detail/CaseSidePanel.tsx");
  const visualCompare = read("components/VisualComparisonStage.tsx");
  const evidenceComposition = read("components/evidence/EvidenceComposition.tsx");

  assert.match(watch, /artifact presence is not a visual-quality verdict/);
  assert.match(cases, /No cases are attached to this run yet/);
  assert.match(collapsible, /aria-controls=\{id \? `\$\{id\}-content` : undefined\}/);
  assert.match(collapsible, /id=\{id \? `\$\{id\}-content` : undefined\}/);
  assert.match(artifact, /setSelected\(\(current\) => artifacts\.includes\(current\)/);
  assert.match(artifact, /aria-pressed=\{selected === artifact\}/);
  assert.match(casePanel, /<Mini label="Output tok\/s"/);
  assert.match(casePanel, /: "—"/);
  assert.match(visualCompare, /Visual quality is not verified, and no visual pass\/fail is inferred/);
  assert.match(visualCompare, /aCaseRef: string \| null;\s*bCaseRef: string \| null/);
  assert.match(visualCompare, /Retry artifact fetch/);
  assert.match(watch, /No cases yet/);
  assert.match(watch, /aria-valuetext=\{resolution == null/);
  assert.match(evidenceComposition, /NUMBER\.format\(safeValue\)\} \/ \{NUMBER\.format\(safeTotal\)/);
});
