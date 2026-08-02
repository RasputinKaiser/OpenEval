import test, { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractSearchText, indexPendingFiles, searchSessions, _setSearchSourcesForTest } from "../lib/collection/search";
import type { CollectionSourceDef } from "../lib/collection/sources";
import { ftsIndexedFiles, _setCacheDbForTest } from "../lib/live-cache";

const cacheDb = new Database(":memory:");
_setCacheDbForTest(cacheDb);

after(() => {
  _setSearchSourcesForTest(null);
  _setCacheDbForTest(null);
  cacheDb.close();
});

function source(id: string, root: string): CollectionSourceDef {
  return { id, label: id, roots: [root], format: "jsonl-dir", parseable: true };
}

test("FTS extraction keeps useful reasoning evidence bounded without raw blocks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-parsing-quality-reasoning-"));
  try {
    const file = path.join(dir, "reasoning.jsonl");
    fs.writeFileSync(file, [
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "compare the source-qualified cache identity" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "(encrypted reasoning)" }],
        },
      },
    ].map((record) => JSON.stringify(record)).join("\n"), "utf8");

    const extracted = extractSearchText(file);
    assert.match(extracted.assistantText, /\[Reasoning\].*source-qualified cache identity/);
    assert.doesNotMatch(extracted.assistantText, /encrypted reasoning/);
    assert.ok(extracted.assistantText.length <= 32_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("incremental FTS indexing rebinds unchanged bytes to the current source", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-parsing-quality-source-"));
  try {
    const file = path.join(dir, "shared.jsonl");
    fs.writeFileSync(file, JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "find the source-qualified handoff" },
    }), "utf8");
    const first = source("source-before", dir);
    const second = source("source-after", dir);

    _setSearchSourcesForTest(() => [first]);
    assert.equal(indexPendingFiles(10).indexed, 1);
    assert.equal(ftsIndexedFiles().get(file)?.sourceId, first.id);

    // Keep the bytes and stat tuple unchanged; only the source registry
    // assignment changes. The indexer must still replace the provenance.
    _setSearchSourcesForTest(() => [second]);
    const progress = indexPendingFiles(10);
    assert.equal(progress.indexed, 1);
    assert.equal(progress.remaining, 0);
    assert.equal(ftsIndexedFiles().get(file)?.sourceId, second.id);
    assert.equal(searchSessions("source-qualified handoff", 10).hits[0]?.sourceId, second.id);
  } finally {
    _setSearchSourcesForTest(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
