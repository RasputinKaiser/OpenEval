import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("session reading flow opens on conversation evidence while keeping raw coverage visible", () => {
  const page = read("app/collection/session/page.tsx");
  const transcript = read("components/TranscriptClient.tsx");

  assert.match(page, /Read the conversation first/);
  assert.match(page, /normalized turns/);
  assert.match(page, /Tool events/);
  assert.match(page, /Error signals/);
  assert.match(transcript, /const defaultFilter: Filter/);
  assert.match(transcript, /totalCounts\?\.chat \?\? countTurns\(turns\)\.chat/);
  assert.match(transcript, /Conversation first/);
  assert.match(transcript, /sticky top-2/);
  assert.match(transcript, /match\{visible\.length === 1 \? "" : "es"\} in loaded turns/);
  assert.match(transcript, /Previous transcript match/);
  assert.match(transcript, /Next transcript match/);
  assert.match(transcript, /No matches in the loaded window\. Load next to continue searching/);
});

test("tool evidence keeps call and result phases inspectable", () => {
  const transcript = read("components/TranscriptClient.tsx");

  assert.match(transcript, /t\.tool\.phase === "call" \? "call" : "result"/);
  assert.match(transcript, /Call \$\{show\(t\.tool\.callId\)\}/);
  assert.match(transcript, /Tool evidence/);
});

test("collection search hands the user off to the session catalog", () => {
  const collection = read("components/CollectionClient.tsx");

  assert.match(collection, /if \(q\.trim\(\) && hits !== null\) selectSection\("sessions"\)/);
  assert.match(collection, /Search and open retained transcript summaries/);
});
