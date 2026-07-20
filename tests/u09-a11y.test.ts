import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * U09 accessibility pass — source-level regression guards for the shared
 * primitives. These are static checks (no DOM runtime in this suite); the
 * behavioral half of the audit is the recorded keyboard walkthrough.
 */

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("layout has a skip-to-content link targeting #main", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /href="#main"/, "skip link must target #main");
  assert.match(layout, /className="skip-link"/, "skip link must use the .skip-link style");
  assert.match(layout, /<main id="main" tabIndex=\{-1\}/, "main must be a focusable skip target");
  const css = read("app/globals.css");
  assert.match(css, /\.skip-link\s*\{/, "globals.css must style .skip-link");
  assert.match(css, /\.skip-link:focus\s*\{/, ".skip-link must become visible on focus");
});

test("global focus-visible ring is defined", () => {
  const css = read("app/globals.css");
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-accent\)/s);
});

test("reduced-motion is respected by owned animations", () => {
  const css = read("app/globals.css");
  const reducedBlocks = css.match(/@media \(prefers-reduced-motion: reduce\)[^{]*\{[\s\S]*?\n\}/g) ?? [];
  const reduced = reducedBlocks.join("\n");
  for (const needle of [".anim-menu-enter", ".shimmer", ".drawer-stagger", ".stagger-grid", "scroll-behavior: auto"]) {
    assert.ok(reduced.includes(needle), `prefers-reduced-motion must cover ${needle}`);
  }
  // Modal primitives must use the class (overridable), not inline animation styles.
  for (const file of [
    "components/CommandPalette.tsx",
    "components/ShortcutsOverlay.tsx",
    "components/MobileNav.tsx",
    "components/ToastProvider.tsx",
  ]) {
    const src = read(file);
    assert.ok(!/style=\{\{\s*animation:\s*"menu-enter/.test(src), `${file} must not inline the menu-enter animation`);
    assert.match(src, /anim-menu-enter/, `${file} must use .anim-menu-enter`);
  }
});

test("command palette implements the combobox/listbox pattern with a focus trap", () => {
  const src = read("components/CommandPalette.tsx");
  assert.match(src, /useFocusTrap/);
  assert.match(src, /role="combobox"/);
  assert.match(src, /aria-controls="palette-listbox"/);
  assert.match(src, /aria-activedescendant=/);
  assert.match(src, /role="listbox"/);
  assert.match(src, /role="option"/);
  assert.match(src, /aria-selected=\{active\}/);
  assert.match(src, /aria-live="polite"/, "result count must be announced");
  assert.match(src, /scrollIntoView\(\{ block: "nearest" \}\)/, "selection must be kept in view");
});

test("shortcuts overlay is a labelled modal dialog with a focus trap", () => {
  const src = read("components/ShortcutsOverlay.tsx");
  assert.match(src, /useFocusTrap/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /aria-labelledby="shortcuts-overlay-title"/);
  assert.match(src, /id="shortcuts-overlay-title"/);
});

test("shortcuts overlay documents every g-navigation shortcut", () => {
  const goto = read("lib/use-goto-navigation.ts");
  const mapMatch = goto.match(/const GOTO[^=]*=\s*\{([\s\S]*?)\};/);
  assert.ok(mapMatch, "GOTO map must exist in lib/use-goto-navigation.ts");
  const keys = Array.from(mapMatch![1].matchAll(/^\s*([a-z]):/gm)).map((m) => m[1]);
  assert.ok(keys.length >= 5, "expected several goto keys");
  const overlay = read("components/ShortcutsOverlay.tsx");
  for (const key of keys) {
    assert.ok(
      overlay.includes(`["g", "${key}"]`),
      `ShortcutsOverlay must document the g+${key} shortcut (keyboard map drifted from use-goto-navigation)`
    );
  }
});

test("mobile nav is a modal dialog: focus trap, escape, current-page marking", () => {
  const src = read("components/MobileNav.tsx");
  assert.match(src, /useFocusTrap/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /e\.key === "Escape"/, "Escape must close the mobile nav");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/);
});

test("sidebar nav is labelled and marks the current page", () => {
  const src = read("components/Sidebar.tsx");
  assert.match(src, /<nav aria-label="Primary"/);
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(src, /sr-only/, "collapsed sidebar must keep labels for AT");
});

test("toasts announce politely and expose variant as text", () => {
  const src = read("components/ToastProvider.tsx");
  assert.match(src, /aria-live="polite"/);
  // One persistent live region only — nesting role="status" toasts inside an
  // aria-live container double-announces in some screen readers.
  assert.ok(!src.includes('role="status"'), "toast items must not nest a second live region");
  assert.match(src, /sr-only/, "variant must be conveyed as text, not color alone");
  assert.match(src, /aria-label="Dismiss notification"/);
});

test("status badge conveys status as text with decorative icon", () => {
  const src = read("components/StatusBadge.tsx");
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /\{m\.label\}/, "status label text must render");
});

test("redact toggle exposes pressed state", () => {
  const src = read("components/RedactToggle.tsx");
  assert.match(src, /aria-pressed=\{redact\}/);
});

test("section jump-nav honors reduced motion and uses aria-current=location", () => {
  const src = read("components/Section.tsx");
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /aria-current=\{active === s\.id \? "location" : undefined\}/);
});
