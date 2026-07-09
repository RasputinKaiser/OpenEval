import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeToolError } from "../lib/live";
import { csvCell } from "../lib/export";
import { getPath } from "../lib/adapters/generic";

// ---- looksLikeToolError (Codex output error sniffing) ----

test("looksLikeToolError does NOT flag benign output containing error-ish words", () => {
  assert.equal(looksLikeToolError("5 passed, 0 failed"), false);
  assert.equal(looksLikeToolError("0 errors, 0 warnings"), false);
  assert.equal(looksLikeToolError("added error handling to the parser"), false);
  assert.equal(looksLikeToolError("Traceback support is enabled"), false);
  assert.equal(looksLikeToolError(""), false);
});

test("looksLikeToolError flags real failure indicators", () => {
  assert.equal(looksLikeToolError("bash: exited with code 1"), true);
  assert.equal(looksLikeToolError("Error: cannot find module 'x'"), true);
  assert.equal(looksLikeToolError("fatal: not a git repository"), true);
  assert.equal(looksLikeToolError("Traceback (most recent call last):\n  File ..."), true);
  assert.equal(looksLikeToolError("bash: foo: command not found"), true);
  assert.equal(looksLikeToolError("cat: x: No such file or directory"), true);
});

// ---- csvCell (RFC-4180 escaping, applied to headers too) ----

test("csvCell always quotes and doubles embedded quotes", () => {
  assert.equal(csvCell("plain"), '"plain"');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('has "quote"'), '"has ""quote"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
});

// ---- getPath (field mapping, incl. leading array index) ----

test("getPath resolves dotted and array-index mappings", () => {
  const obj = { message: { content: [{ text: "hi" }, { text: "bye" }] }, n: 3 };
  assert.equal(getPath(obj, "n"), 3);
  assert.equal(getPath(obj, "message.content[1].text"), "bye");
  assert.equal(getPath(obj, undefined), undefined);
  assert.equal(getPath(obj, "missing.deep"), undefined);
});

test("getPath handles a mapping that STARTS with an array index", () => {
  const arr = [{ text: "first" }, { text: "second" }];
  assert.equal(getPath(arr, "[0].text"), "first");
  assert.equal(getPath(arr, "[1].text"), "second");
});
