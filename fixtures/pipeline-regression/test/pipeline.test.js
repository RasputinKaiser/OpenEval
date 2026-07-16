const { test } = require("node:test");
const assert = require("node:assert");
const { sum, average, max, variance } = require("../lib");

test("sum of list", () => {
  assert.equal(sum([1, 2, 3, 4]), 10);
  assert.equal(sum([]), 0);
});
test("average of list", () => {
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([]), 0);
});
test("max of list", () => {
  assert.equal(max([1, 5, 3, 2]), 5);
  assert.equal(max([-1, -5, -3]), -1);
});
test("variance is population variance", () => {
  assert.ok(Math.abs(variance([2, 4, 6]) - (8 / 3)) < 1e-9);
});
