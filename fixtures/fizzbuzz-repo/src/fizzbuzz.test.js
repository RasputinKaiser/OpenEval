const { test } = require("node:test");
const assert = require("node:assert");
const { fizzbuzz } = require("./fizzbuzz");

test("returns numbers for 1 and 2", () => {
  assert.match(fizzbuzz(2), /^1,2$/);
});
test("returns Fizz for multiples of 3 only", () => {
  const parts = fizzbuzz(6).split(",");
  assert.equal(parts[2], "Fizz");
  assert.equal(parts[5], "Fizz");
});
test("returns Buzz for multiples of 5 only", () => {
  const parts = fizzbuzz(10).split(",");
  assert.equal(parts[4], "Buzz");
  assert.equal(parts[9], "Buzz");
});
test("returns FizzBuzz for multiples of 15", () => {
  const parts = fizzbuzz(30).split(",");
  assert.equal(parts[14], "FizzBuzz");
  assert.equal(parts[29], "FizzBuzz");
});
