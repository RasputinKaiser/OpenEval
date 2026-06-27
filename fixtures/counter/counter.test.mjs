import { test } from "node:test";
import assert from "node:assert";
import { makeCounter } from "./counter.mjs";

test("next increments", () => {
  const c = makeCounter(10);
  assert.equal(c.next(), 11);
  assert.equal(c.next(), 12);
});
test("reset returns to start", () => {
  const c = makeCounter(5);
  c.next(); c.next();
  assert.equal(c.reset(), 5);
});
test("value reads current", () => {
  const c = makeCounter(0);
  c.next();
  assert.equal(c.value(), 1);
});
