import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("UX-250 manifest keeps product-QA coverage separate from runnable capability", () => {
  const manifest = JSON.parse(read("docs/ux-250-manifest.json")) as {
    rowRange: { first: string; last: string; totalRows: number };
    denominator: { runnableBenchmarkCases: number; providerRunsAdded: number };
    evidencePosture: { fixedRows: number; pendingRows: number };
  };
  assert.deepEqual(manifest.rowRange, { first: "US-2001", last: "US-2250", totalRows: 250 });
  assert.equal(manifest.denominator.runnableBenchmarkCases, 35);
  assert.equal(manifest.denominator.providerRunsAdded, 0);
  assert.equal(manifest.evidencePosture.fixedRows, 225);
  assert.equal(manifest.evidencePosture.pendingRows, 25);
});

test("UX-250 source contracts retain theme and responsive safeguards", () => {
  const css = read("app/globals.css");
  const evaluateNav = read("components/EvaluateNav.tsx");
  const mobileNav = read("components/MobileNav.tsx");

  assert.match(css, /:root\.light/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
  assert.match(evaluateNav, /grid-cols-2.*sm:grid-cols-3.*xl:grid-cols-6/);
  assert.match(evaluateNav, /aria-current/);
  assert.match(mobileNav, /safe-area-inset-bottom/);
  assert.match(mobileNav, /role="dialog"/);
});

test("UX-250 canonical rows are contiguous and grouped into five equal UX lanes", () => {
  const rows = read("docs/user-stories.md")
    .split(/\r?\n/)
    .filter((line) => /^\| US-\d{3,4} \|/.test(line));
  const uxRows = rows.filter((row) => {
    const id = Number(row.match(/US-(\d+)/)?.[1]);
    return id >= 2001 && id <= 2250;
  });
  assert.equal(uxRows.length, 250);
  assert.equal(uxRows.at(-1)?.split(" | ")[0], "| US-2250");

  const groups = new Map<string, number>();
  for (const row of uxRows) {
    const prefix = row.split(" | ")[1].split(" / ")[0];
    groups.set(prefix, (groups.get(prefix) ?? 0) + 1);
  }
  assert.equal(groups.size, 5);
  for (const count of groups.values()) assert.equal(count, 50);
});
