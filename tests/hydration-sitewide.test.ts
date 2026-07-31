import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DISPLAY_LOCALE,
  DISPLAY_TIME_ZONE,
  fmtDateTime,
  fmtStableDateTime,
  fmtTime,
} from "../lib/format";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const REFERENCE_MS = Date.UTC(2026, 6, 16, 3, 0, 0);

test("shared time formatters keep locale/timezone explicit and server fallback absolute", () => {
  assert.equal(DISPLAY_LOCALE, "en-US");
  assert.equal(DISPLAY_TIME_ZONE, "UTC");
  assert.equal(fmtStableDateTime(REFERENCE_MS), "2026-07-16T03:00:00.000Z");
  assert.match(fmtDateTime(REFERENCE_MS), /Jul 16, 2026/);
  assert.match(fmtDateTime(REFERENCE_MS), /3:00 AM/);
  assert.match(fmtTime(REFERENCE_MS), /3:00:00 AM/);
  assert.equal(fmtStableDateTime(undefined), "—");
});

test("Dashboard recent sessions render a stable time before client-only relative updates", () => {
  const source = read("components/RecentSessions.tsx");
  assert.match(source, /referenceTimeMs\?: number/);
  assert.match(source, /useState<number \| null>\(referenceTimeMs \?\? null\)/);
  assert.match(source, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 60_000\)/);
  assert.match(source, /fmtRel\(s\.lastEventAt, nowMs\)/);
  assert.match(source, /<time[\s\S]*dateTime=\{fmtStableDateTime\(s\.lastEventAt\)\}/);
});

test("Runs keep date grouping and localized labels out of the hydration render", () => {
  const source = read("components/RunsClient.tsx");
  assert.match(source, /referenceTimeMs\?: number/);
  assert.match(source, /if \(!dateSorted \|\| nowMs === null\)/);
  assert.match(source, /getUTCFullYear\(\)/);
  assert.match(source, /<time dateTime=\{fmtStableDateTime\(r\.created_at\)\}/);
  assert.doesNotMatch(source, /toLocale(?:String|DateString|TimeString)\(/);
});

test("Transcript and drawer timestamps expose absolute dateTime values", () => {
  const transcript = read("components/TranscriptClient.tsx");
  assert.match(transcript, /useState\(false\)/);
  assert.match(transcript, /fmtStableDateTime\(t\.at\)/);
  assert.match(transcript, /mounted \? fmtTime\(t\.at\) : fmtStableDateTime\(t\.at\)/);
  assert.match(transcript, /<time[\s\S]*dateTime=\{fmtStableDateTime\(t\.at\)\}/);

  const drawer = read("components/live/SessionDrawer.tsx");
  assert.match(drawer, /function Timestamp/);
  assert.match(drawer, /dateTime=\{stable\}/);
  assert.match(drawer, /mounted \? fmtTime\(ms\) : stable/);
  assert.doesNotMatch(drawer, /toLocale(?:String|DateString|TimeString)\(/);
});
