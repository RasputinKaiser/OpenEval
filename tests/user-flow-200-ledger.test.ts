import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("User-flow-200 manifest keeps proficiency coverage separate from runnable capability", () => {
  const manifest = JSON.parse(read("docs/user-flow-200-manifest.json")) as {
    rowRange: { first: string; last: string; totalRows: number };
    groups: Array<{ level: string; rows: number; fixedRows: number; pendingRows: number }>;
    denominator: { runnableBenchmarkCases: number; capabilityNuclei: number; providerRunsAdded: number };
    evidencePosture: { fixedRows: number; pendingRows: number };
  };
  assert.deepEqual(manifest.rowRange, { first: "US-2251", last: "US-2450", totalRows: 200 });
  assert.deepEqual(manifest.groups.map((group) => group.level), ["brand-new-user", "beginner", "intermediate", "expert"]);
  assert.deepEqual(manifest.groups.map((group) => group.rows), [50, 50, 50, 50]);
  assert.deepEqual(manifest.groups.map((group) => group.fixedRows), [45, 45, 45, 45]);
  assert.deepEqual(manifest.groups.map((group) => group.pendingRows), [5, 5, 5, 5]);
  assert.equal(manifest.denominator.runnableBenchmarkCases, 35);
  assert.equal(manifest.denominator.capabilityNuclei, 100);
  assert.equal(manifest.denominator.providerRunsAdded, 0);
  assert.equal(manifest.evidencePosture.fixedRows, 180);
  assert.equal(manifest.evidencePosture.pendingRows, 20);
});

test("User-flow-200 rows are contiguous, complete, and balanced across proficiency lanes", () => {
  const rows = read("docs/user-stories.md")
    .split(/\r?\n/)
    .filter((line) => /^\| US-\d{3,4} \|/.test(line))
    .filter((line) => {
      const id = Number(line.match(/US-(\d+)/)?.[1]);
      return id >= 2251 && id <= 2450;
    });
  assert.equal(rows.length, 200);
  assert.deepEqual(rows.map((row) => row.split(" | ")[0]), Array.from({ length: 200 }, (_, index) => "| US-" + String(index + 2251).padStart(4, "0")));

  const groups = new Map<string, number>();
  const statuses = new Map<string, number>();
  for (const row of rows) {
    const cells = row.split(" | ");
    const group = cells[1].split(" / ")[0];
    groups.set(group, (groups.get(group) ?? 0) + 1);
    statuses.set(cells[5], (statuses.get(cells[5]) ?? 0) + 1);
    assert.ok(cells[2].startsWith("As "));
    assert.ok(cells[3].includes("current state and next action"));
    assert.match(cells[4], /user-flow-200-ledger\.test\.ts/);
    assert.ok(cells[8].length > 0);
  }
  assert.deepEqual([...groups.values()].sort((a, b) => a - b), [50, 50, 50, 50]);
  assert.equal(statuses.get("FIXED"), 180);
  assert.equal(statuses.get("PENDING"), 20);
  assert.equal(statuses.get("FAIL") ?? 0, 0);
});

test("User-flow-200 high-value first-run and launch contracts are explicit", () => {
  const onboarding = read("components/OnboardingOverlay.tsx");
  const harnessPicker = read("components/HarnessPicker.tsx");
  const casesPage = read("app/cases/page.tsx");
  const newRun = read("components/NewRunClient.tsx");

  assert.match(onboarding, /api\/collection\?mode=discover/);
  assert.match(onboarding, /aria-labelledby="onboarding-title"/);
  assert.match(onboarding, /focusable/);
  assert.match(onboarding, /data-onboarding-close/);
  assert.match(harnessPicker, /invalidateCache\(url\)/);
  assert.match(casesPage, /Start with Core suite/);
  assert.match(casesPage, /href="\/runs\/new"/);
  assert.match(newRun, /data-testid="hidden-selected-cases"/);
  assert.match(newRun, /Clear all/);
  assert.match(newRun, /Show selected/);
});
