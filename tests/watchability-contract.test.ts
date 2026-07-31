import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.join(__dirname, "..");

test("watch mode exposes one atomic live status and an explicit current lifecycle step", () => {
  const source = fs.readFileSync(path.join(ROOT, "components/RunWatch.tsx"), "utf8");

  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /data-testid="run-watch-announcement"/);
  assert.match(source, /watchStatusAnnouncement/);
  assert.match(source, /role="list" aria-label="Case lifecycle"/);
  assert.match(source, /role="listitem" aria-current=\{currentStep \? "step"/);
  assert.match(source, /Event stream \$\{stream\}/);
  assert.match(source, /closed \? "closed"/);
});
