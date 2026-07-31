import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function source() {
  return readFileSync("index.html", "utf8");
}

function runInlineInteraction() {
  const script = source().match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script, "page must contain an inline interaction script");

  const listeners = new Map();
  const form = { addEventListener(name, handler) { listeners.set(name, handler); } };
  const status = { value: "" };
  const items = [
    { dataset: { status: "passed" }, hidden: false },
    { dataset: { status: "failed" }, hidden: false },
    { dataset: { status: "blocked" }, hidden: false },
  ];
  const empty = { hidden: false };
  const document = {
    querySelector(selector) {
      if (selector === '[data-testid="filter-form"]') return form;
      if (selector === "#status") return status;
      if (selector === '[data-testid="empty-state"]') return empty;
      throw new Error(`unexpected selector: ${selector}`);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-testid="result-list"] [data-status]');
      return items;
    },
  };

  vm.runInNewContext(script, { document });
  const submit = listeners.get("submit");
  assert.equal(typeof submit, "function", "form must handle submit, not only pointer clicks");
  return { form, status, items, empty, submit };
}

test("uses explicit accessible names and semantic form controls", () => {
  const html = source();
  assert.match(html, /<html\s+lang="en">/i);
  assert.match(html, /<form[^>]*aria-label="Filter benchmark runs"/i);
  assert.match(html, /<label\s+for="status">Status<\/label>/i);
  assert.match(html, /<button\s+type="submit">Apply filter<\/button>/i);
  assert.match(html, /data-testid="empty-state"[^>]*aria-live="polite"/i);
  assert.doesNotMatch(html, /onclick\s*=|role="button"/i);
});

test("filters results through the keyboard-submit path and exposes an empty state", () => {
  const { status, items, empty, submit } = runInlineInteraction();
  let prevented = false;
  status.value = "failed";
  submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(items.map((item) => item.hidden), [true, false, true]);
  assert.equal(empty.hidden, true);

  status.value = "not-a-status";
  submit({ preventDefault() {} });
  assert.deepEqual(items.map((item) => item.hidden), [true, true, true]);
  assert.equal(empty.hidden, false);
});

test("does not depend on a network resource", () => {
  const html = source();
  assert.doesNotMatch(html, /\b(?:src|href)=(["'])(?!#|data:)/i);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/i);
});
