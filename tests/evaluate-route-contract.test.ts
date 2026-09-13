import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const EVALUATE_ROUTES = [
  { href: "/runs", label: "Runs", description: "Track evaluations" },
  { href: "/runs/leaderboard", label: "Leaderboard", description: "Review standings" },
  { href: "/runs/compare", label: "Compare", description: "Find regressions" },
  { href: "/cases", label: "Cases", description: "Curate the suite" },
  { href: "/runs/new", label: "New run", description: "Launch an experiment" },
  { href: "/accuracy", label: "Accuracy", description: "Audit evidence" },
] as const;

test("Evaluate workflow exposes the complete route inventory in stable order", () => {
  const evaluateNav = read("components/EvaluateNav.tsx");
  const sidebar = read("components/Sidebar.tsx");
  const navStart = evaluateNav.indexOf("export const EVALUATE_ITEMS = [");
  const navEnd = evaluateNav.indexOf("] as const;", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart, "EvaluateNav must declare a bounded route inventory");
  const navInventory = evaluateNav.slice(navStart, navEnd);

  const sidebarStart = sidebar.indexOf('label: "Evaluate"');
  const sidebarEnd = sidebar.indexOf('label: "System"', sidebarStart);
  assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart, "Sidebar must retain a bounded Evaluate section");
  const sidebarEvaluate = sidebar.slice(sidebarStart, sidebarEnd);

  const expectedHrefs = EVALUATE_ROUTES.map((route) => route.href);
  const navHrefs = Array.from(navInventory.matchAll(/href: "([^"]+)"/g), (match) => match[1]);
  const sidebarHrefs = Array.from(sidebarEvaluate.matchAll(/href: "([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(navHrefs, expectedHrefs, "EvaluateNav route inventory drifted");
  assert.deepEqual(sidebarHrefs, expectedHrefs, "Sidebar Evaluate route inventory drifted");

  for (const route of EVALUATE_ROUTES) {
    const navIndex = navInventory.indexOf(`href: "${route.href}"`);
    const navItem = navInventory.slice(navIndex, navInventory.indexOf("}", navIndex) + 1);
    assert.match(navItem, new RegExp(`label: "${route.label}"`));
    assert.match(navItem, new RegExp(`description: "${route.description}"`));
  }

  assert.match(evaluateNav, /data-testid="evaluate-workflow-nav"/);
  assert.match(evaluateNav, /grid-cols-2.*sm:grid-cols-3.*xl:grid-cols-6/);
  assert.match(evaluateNav, /aria-label="Evaluate pages"/);
  assert.match(evaluateNav, /EVALUATE_ITEMS\.map/);
  assert.match(evaluateNav, /aria-current=\{selected \? "page" : undefined\}/);
});

test("Evaluate navigation keeps special run tools from stealing the Runs active state", () => {
  const evaluateNav = read("components/EvaluateNav.tsx");
  const runsBranch = evaluateNav.slice(
    evaluateNav.indexOf('if (href === "/runs")'),
    evaluateNav.indexOf('if (href === "/runs/new"'),
  );

  assert.match(runsBranch, /pathname === "\/runs"/);
  assert.ok(runsBranch.includes("(?!new(?:/|$)|compare(?:/|$)|leaderboard(?:/|$))"), "Runs guard must exclude special run tools");
  assert.match(evaluateNav, /if \(href === "\/runs\/new" \|\| href === "\/runs\/compare" \|\| href === "\/runs\/leaderboard"\) return pathname === href;/);
  assert.match(evaluateNav, /aria-current=\{selected \? "page" : undefined\}/);
});

test("Evaluate workflow navigation is mounted on each primary evaluation surface", () => {
  const surfaces = [
    "app/runs/page.tsx",
    "components/LeaderboardClient.tsx",
    "components/CompareClient.tsx",
    "app/cases/page.tsx",
    "components/NewRunClient.tsx",
    "components/AccuracyClient.tsx",
  ];

  for (const surface of surfaces) {
    assert.match(read(surface), /EvaluateNav/, `${surface} must mount the shared Evaluate navigation`);
  }
});
