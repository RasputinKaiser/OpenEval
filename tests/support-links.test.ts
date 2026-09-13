import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("support surface exposes the canonical outbound links with safe external navigation", () => {
  const source = read("components/SupportLinks.tsx");
  const links = [
    ["Support OpenEval", "https://ko-fi.com/rasputinkaiser"],
    ["Contact on X", "https://x.com/RasputinKaiser"],
    ["Other projects", "https://ras.artificiallexicon.com/"],
    ["Learning AI", "https://www.artificiallexicon.com/"],
  ] as const;

  for (const [label, href] of links) {
    assert.match(source, new RegExp(`label: "${label}"`));
    assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /OpenEval is free and local-first/);
  assert.match(source, /Support is optional/);
});

test("support links are reachable from both persistent desktop and mobile navigation", () => {
  const sidebar = read("components/Sidebar.tsx");
  const mobile = read("components/MobileNav.tsx");
  const readme = read("README.md");

  assert.match(sidebar, /<SupportLinks compact collapsed=\{collapsed\} headingId="desktop-support-links-title" \/>/);
  assert.match(mobile, /<SupportLinks headingId="mobile-support-links-title" \/>/);
  assert.match(mobile, /useFocusTrap\(panelRef, open\)/);
  assert.match(readme, /\]\(https:\/\/ko-fi\.com\/rasputinkaiser\)/);
});
