const { test } = require("node:test");
const assert = require("node:assert");
const { rangeSum } = require("./range");

test("sums 1..5 to 15", () => {
  assert.equal(rangeSum(5), 15);
});

test("sums the single element 1..1 to 1", () => {
  assert.equal(rangeSum(1), 1);
});
