import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Accuracy gives each evidence gap a direct next step in Evaluate", () => {
  const source = read("components/AccuracyClient.tsx");
  const actionsStart = source.indexOf('aria-label="Evaluation evidence actions"');
  const actionsEnd = source.indexOf("</section>", actionsStart);
  const actions = source.slice(actionsStart, actionsEnd);
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, "Accuracy must expose a bounded evidence-actions section");

  assert.match(actions, /<Link href="\/cases"[\s\S]*?>Inspect cases →<\/Link>/);
  assert.match(actions, /<Link href="\/runs\/new"[\s\S]*?>Run a suite →<\/Link>/);
  assert.match(actions, /<Link href="\/runs"[\s\S]*?>Review runs →<\/Link>/);
  assert.match(source, /<EvaluateNav \/>/);
});

test("Accuracy makes judge configuration visible without overstating verdict evidence", () => {
  const client = read("components/AccuracyClient.tsx");
  const page = read("app/accuracy/page.tsx");

  assert.match(client, />Judge posture<\/div>/);
  assert.match(client, />configuration only<\/span>/);
  assert.match(client, /\{judge\.harness\}\{judge\.model \? /);
  assert.match(client, /judge\.reasoningEffort/);
  assert.match(client, /A judge verdict is evidence only when the selected backend returns a valid score\./);
  assert.match(client, /This route audits case-definition contracts and local oracle availability\. It does not replay an agent, run a judge, or inspect rendered pixels\./);

  assert.match(page, /const judge = resolveJudge\(\);/);
  assert.match(page, /<AccuracyClient audit=\{audit\} judge=\{judge\} \/>/);
});
