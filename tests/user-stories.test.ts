import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const LEDGER = path.join(__dirname, "..", "docs", "user-stories.md");
const MANIFEST = path.join(__dirname, "..", "docs", "benchmark-ledger-manifest.json");
const UX_MANIFEST = path.join(__dirname, "..", "docs", "ux-250-manifest.json");
const USER_FLOW_MANIFEST = path.join(__dirname, "..", "docs", "user-flow-200-manifest.json");
const VALID_STATUSES = new Set(["PASS", "FIXED", "FAIL", "PENDING", "BLOCKED"]);

test("canonical OpenEval user-story ledger contains 2450 complete stories", () => {
  const rows = fs.readFileSync(LEDGER, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\| US-\d{3,4} \|/.test(line));
  const ledgerText = fs.readFileSync(LEDGER, "utf8");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
    ledger: { totalRows: number; priorRows: number; nextRows: number; nextRowGroups: number; rowsPerGroup: number; uxRows: number; userFlowRows: number };
    denominator: { runnableCases: number; capabilityNuclei: number; nextBatchEvidenceLensRows: number };
  };

  assert.equal(rows.length, 2450);
  assert.deepEqual({
    totalRows: manifest.ledger.totalRows,
    priorRows: manifest.ledger.priorRows,
    nextRows: manifest.ledger.nextRows,
    nextRowGroups: manifest.ledger.nextRowGroups,
    rowsPerGroup: manifest.ledger.rowsPerGroup,
    uxRows: manifest.ledger.uxRows,
    userFlowRows: manifest.ledger.userFlowRows,
  }, { totalRows: 2450, priorRows: 1000, nextRows: 1000, nextRowGroups: 10, rowsPerGroup: 100, uxRows: 250, userFlowRows: 200 });
  assert.deepEqual({
    runnableCases: 35,
    capabilityNuclei: 100,
    nextBatchEvidenceLensRows: 1000,
  }, {
    runnableCases: manifest.denominator.runnableCases,
    capabilityNuclei: manifest.denominator.capabilityNuclei,
    nextBatchEvidenceLensRows: manifest.denominator.nextBatchEvidenceLensRows,
  });
  assert.match(ledgerText, /35\/35 known-bad scripts/);
  assert.doesNotMatch(ledgerText, /13 of 18 cases lack known-bad/);
  const ids = rows.map((row) => row.split(" | ")[0].slice(2));
  assert.equal(new Set(ids).size, 2450);
  assert.deepEqual(ids, Array.from({ length: 2450 }, (_, index) => "US-" + String(index + 1).padStart(3, "0")));

  const nextThousand = rows.filter((row) => {
    const id = Number(row.match(/US-(\d+)/)?.[1]);
    return id >= 1001 && id <= 2000;
  });
  const groupPrefixes = new Set(nextThousand.map((row) => row.split(" | ")[1].split(" / ")[0]));
  assert.equal(nextThousand.length, 1000);
  assert.equal(groupPrefixes.size, 10);
  for (const prefix of groupPrefixes) {
    assert.equal(nextThousand.filter((row) => row.split(" | ")[1].startsWith(`${prefix} / `)).length, 100);
  }

  assert.match(ledgerText, /2,000 ledger rows are not 2,000 independent provider evaluations/);
  assert.match(ledgerText, /2,450-row ledger is not a declaration/);
  assert.match(ledgerText, /only rows backed by distinct cases, fixtures, graders, or evidence contracts belong in the runnable denominator/);
  for (const evidenceName of [
    "swe-atomic-batch",
    "visual-supplied-data-svg",
    "visual-accessible-filter-form",
    "strict judge verdict validation",
    "accessibility launcher polish",
    "screen-reader watch status",
    "observation reliability lane",
  ]) {
    assert.match(ledgerText, new RegExp(evidenceName.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")), evidenceName);
  }

  const uxManifest = JSON.parse(fs.readFileSync(UX_MANIFEST, "utf8")) as {
    rowRange: { first: string; last: string; totalRows: number };
    groups: Array<{ prefix: string; rows: number; fixedRows: number; pendingRows: number }>;
    denominator: { runnableBenchmarkCases: number; providerRunsAdded: number };
    evidencePosture: { fixedRows: number; pendingRows: number };
  };
  assert.deepEqual(uxManifest.rowRange, { first: "US-2001", last: "US-2250", totalRows: 250 });
  assert.equal(uxManifest.groups.length, 5);
  assert.equal(uxManifest.groups.reduce((sum, group) => sum + group.rows, 0), 250);
  assert.equal(uxManifest.groups.reduce((sum, group) => sum + group.fixedRows, 0), 225);
  assert.equal(uxManifest.groups.reduce((sum, group) => sum + group.pendingRows, 0), 25);
  assert.equal(uxManifest.denominator.runnableBenchmarkCases, 35);
  assert.equal(uxManifest.denominator.providerRunsAdded, 0);
  assert.equal(uxManifest.evidencePosture.fixedRows, 225);
  assert.equal(uxManifest.evidencePosture.pendingRows, 25);

  const uxRows = rows.filter((row) => {
    const id = Number(row.match(/US-(\d+)/)?.[1]);
    return id >= 2001 && id <= 2250;
  });
  assert.equal(uxRows.length, 250);
  const uxGroupPrefixes = new Set(uxRows.map((row) => row.split(" | ")[1].split(" / ")[0]));
  assert.equal(uxGroupPrefixes.size, 5);
  for (const prefix of uxGroupPrefixes) {
    assert.equal(uxRows.filter((row) => row.split(" | ")[1].startsWith(prefix + " / ")).length, 50);
  }

  const userFlowManifest = JSON.parse(fs.readFileSync(USER_FLOW_MANIFEST, "utf8")) as {
    rowRange: { first: string; last: string; totalRows: number };
    groups: Array<{ level: string; rows: number; fixedRows: number; pendingRows: number }>;
    denominator: { runnableBenchmarkCases: number; providerRunsAdded: number };
    evidencePosture: { fixedRows: number; pendingRows: number };
  };
  assert.deepEqual(userFlowManifest.rowRange, { first: "US-2251", last: "US-2450", totalRows: 200 });
  assert.equal(userFlowManifest.groups.length, 4);
  assert.equal(userFlowManifest.groups.reduce((sum, group) => sum + group.rows, 0), 200);
  assert.equal(userFlowManifest.groups.reduce((sum, group) => sum + group.fixedRows, 0), 180);
  assert.equal(userFlowManifest.groups.reduce((sum, group) => sum + group.pendingRows, 0), 20);
  assert.equal(userFlowManifest.denominator.runnableBenchmarkCases, 35);
  assert.equal(userFlowManifest.denominator.providerRunsAdded, 0);
  assert.equal(userFlowManifest.evidencePosture.fixedRows, 180);
  assert.equal(userFlowManifest.evidencePosture.pendingRows, 20);

  const userFlowRows = rows.filter((row) => {
    const id = Number(row.match(/US-(\d+)/)?.[1]);
    return id >= 2251 && id <= 2450;
  });
  assert.equal(userFlowRows.length, 200);
  const userFlowGroups = new Map<string, number>();
  for (const row of userFlowRows) {
    const group = row.split(" | ")[1].split(" / ")[0];
    userFlowGroups.set(group, (userFlowGroups.get(group) ?? 0) + 1);
  }
  assert.deepEqual([...userFlowGroups.entries()].sort(), [
    ["User flow — Beginner", 50],
    ["User flow — Brand-new user", 50],
    ["User flow — Expert", 50],
    ["User flow — Intermediate", 50],
  ]);

  const statusCounts = new Map<string, number>();
  for (const row of rows) {
    const status = row.split(" | ")[5];
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const expectedStatusCounts: ReadonlyArray<readonly [string, number]> = [
    ["PASS", 1743], ["FIXED", 486], ["FAIL", 0], ["PENDING", 219], ["BLOCKED", 2],
  ];
  for (const [status, count] of expectedStatusCounts) {
    assert.equal(statusCounts.get(status) ?? 0, count);
    assert.match(ledgerText, new RegExp(`\\| ${status} \\| ${count} \\|`));
  }

  for (const row of rows) {
    const cells = row.split(" | ");
    assert.equal(cells.length, 9, `story row should have nine cells: ${row}`);
    assert.ok(cells[2].startsWith("As "), `story should be phrased as a user story: ${cells[0]}`);
    assert.ok(cells[3].length > 20, `story should declare expected behavior: ${cells[0]}`);
    assert.ok(cells[4].length > 5, `story should name evidence: ${cells[0]}`);
    assert.ok(VALID_STATUSES.has(cells[5]), `unknown story status ${cells[5]}: ${cells[0]}`);
    assert.ok(cells[8].length > 0, `story should declare retest status: ${cells[0]}`);
  }
});
