const { test } = require("node:test");
const assert = require("node:assert");
const { isLeapYear } = require("../lib/leap");

test("typical leap years", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(1996), true);
});
test("common years", () => {
  assert.equal(isLeapYear(2023), false);
  assert.equal(isLeapYear(1901), false);
});
test("century non-leap years", () => {
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2100), false);
});
test(" quadricentennial is a leap year", () => {
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1600), true);
});
