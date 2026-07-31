import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Evaluate controls keep the planned recipe visibly selected and touch-sized", () => {
  const launch = read("components/NewRunClient.tsx");
  const compare = read("components/CompareClient.tsx");
  const accuracy = read("components/AccuracyClient.tsx");

  assert.match(launch, /const plannedCaseIds = new Set\(plannedCases\.map/);
  assert.match(launch, /plannedCaseIds\.size === presetCaseIds\.size/);
  assert.match(launch, /focus-visible:ring-2 focus-visible:ring-accent/);
  assert.match(compare, /min-h-11 w-full px-3 py-2/);
  assert.match(accuracy, /inline-flex min-h-10 items-center/);
  assert.match(accuracy, /min-h-10 w-full rounded-md border/);
});
test("narrow Evaluate tables announce horizontal inspection and loading states", () => {
  const leaderboard = read("components/LeaderboardClient.tsx");
  const compare = read("components/CompareClient.tsx");

  assert.match(leaderboard, /tabIndex=\{0\} aria-label="Scrollable harness leaderboard table"/);
  assert.match(leaderboard, /Swipe horizontally to inspect cost, tokens, speed, and model/);
  assert.match(leaderboard, /role="status" aria-live="polite"/);
  assert.match(compare, /role="status" aria-live="polite" className=.*Loading diff/);
});
