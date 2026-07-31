"use strict";

// Intentionally incomplete baseline: a rejected batch leaks work performed by
// earlier operations and emits no rollback event.
function applyTransaction(state, operations) {
  const workingState = { ...state };
  const events = [{ type: "transaction.started", operationCount: operations.length }];

  for (const operation of operations) {
    if (!Number.isInteger(operation.amount) || operation.amount <= 0) {
      return {
        ok: false,
        state: workingState,
        events: [...events, { type: "transaction.rejected", reason: "invalid_amount" }],
        error: "invalid_amount",
      };
    }
    if (operation.type === "debit") {
      if (operation.amount > workingState.balance) {
        return {
          ok: false,
          state: workingState,
          events: [...events, { type: "transaction.rejected", reason: "insufficient_funds" }],
          error: "insufficient_funds",
        };
      }
      workingState.balance -= operation.amount;
      events.push({ type: "debit.applied", amount: operation.amount });
    } else if (operation.type === "credit") {
      workingState.balance += operation.amount;
      events.push({ type: "credit.applied", amount: operation.amount });
    } else {
      return {
        ok: false,
        state: workingState,
        events: [...events, { type: "transaction.rejected", reason: "unknown_operation" }],
        error: "unknown_operation",
      };
    }
  }

  workingState.version += 1;
  events.push({ type: "transaction.committed", version: workingState.version });
  return { ok: true, state: workingState, events };
}

module.exports = { applyTransaction };
