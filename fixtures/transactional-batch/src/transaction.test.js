const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTransaction } = require("./transaction");

test("commits a valid batch and records ordered events", () => {
  const original = { balance: 100, version: 4 };
  const result = applyTransaction(original, [
    { type: "debit", amount: 30 },
    { type: "credit", amount: 5 },
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { balance: 75, version: 5 });
  assert.deepEqual(result.events.map((event) => event.type), [
    "transaction.started",
    "debit.applied",
    "credit.applied",
    "transaction.committed",
  ]);
  assert.deepEqual(original, { balance: 100, version: 4 });
});

test("rolls back earlier operations when a later debit overdrafts", () => {
  const original = { balance: 100, version: 7 };
  const result = applyTransaction(original, [
    { type: "debit", amount: 60 },
    { type: "debit", amount: 50 },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.error, "insufficient_funds");
  assert.deepEqual(result.state, original);
  assert.deepEqual(result.events.map((event) => event.type), [
    "transaction.started",
    "debit.applied",
    "transaction.rolled_back",
  ]);
  assert.equal(result.events.some((event) => event.type === "transaction.committed"), false);
});

test("rolls back invalid amounts without mutating the input", () => {
  const original = { balance: 40, version: 2 };
  const result = applyTransaction(original, [{ type: "credit", amount: 0 }]);

  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_amount");
  assert.deepEqual(result.state, original);
  assert.equal(result.events.at(-1).type, "transaction.rolled_back");
});

test("does not commit an unknown operation", () => {
  const original = { balance: 40, version: 2 };
  const result = applyTransaction(original, [{ type: "transfer", amount: 5 }]);

  assert.equal(result.ok, false);
  assert.equal(result.error, "unknown_operation");
  assert.deepEqual(result.state, original);
  assert.equal(result.events.at(-1).type, "transaction.rolled_back");
});
