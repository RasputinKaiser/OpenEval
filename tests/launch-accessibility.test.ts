import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("New Run keeps phone-width controls usable and visibly focusable", () => {
  const client = read("components/NewRunClient.tsx");
  assert.match(client, /grid grid-cols-1 gap-4 sm:grid-cols-2/);
  assert.match(client, /id="parallel-workers"[\s\S]*inputMode="numeric"[\s\S]*min-h-11/);
  assert.match(client, /id="run-samples"[\s\S]*inputMode="numeric"[\s\S]*min-h-11/);
  assert.match(client, /data-testid="start-blockers"/);
  assert.match(client, /focus-visible:ring-2 focus-visible:ring-accent/);
});

test("Harness and model pickers dismiss with Escape and expose touch-sized options", () => {
  for (const file of ["components/HarnessPicker.tsx", "components/ModelPicker.tsx"]) {
    const picker = read(file);
    assert.match(picker, /if \(!open\) return;/, file);
    assert.match(picker, /event\.key === "Escape"/, file);
    assert.match(picker, /aria-hidden="true" className="fixed inset-0 z-10"/, file);
    assert.match(picker, /min-h-10 w-full flex items-center/, file);
    assert.match(picker, /focus-visible:ring-2 focus-visible:ring-accent/, file);
  }
});
