import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "components/run-detail/CaseListPanel.tsx"), "utf8");
const caseRow = source.slice(source.indexOf("function CaseRow"));

test("case rows use native button semantics without nesting controls", () => {
  assert.doesNotMatch(caseRow, /role="button"/, "the row wrapper must not impersonate a button");
  assert.doesNotMatch(caseRow, /tabIndex=\{0\}/, "row focus must come from the native selection button");
  assert.match(caseRow, /<button[\s\S]*?type="button"[\s\S]*?onClick=\{onSelect\}/);

  const selectionButton = caseRow.match(/<button[\s\S]*?>([\s\S]*?)<\/button>/)?.[1];
  assert.ok(selectionButton, "case selection button must have a body");
  assert.doesNotMatch(selectionButton, /type="checkbox"|<Link\b/, "checkbox and re-run link must remain button siblings");
  assert.match(caseRow, /type="checkbox"[\s\S]*?aria-label=\{`Select \$\{c\.case_name\} for re-run`\}/);
  assert.match(caseRow, /<Link[\s\S]*?aria-label=\{`Re-run \$\{c\.case_name\}`\}/);
});
