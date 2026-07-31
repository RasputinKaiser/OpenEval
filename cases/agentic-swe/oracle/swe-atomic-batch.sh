#!/usr/bin/env bash
set -euo pipefail
cat > src/transaction.js <<'JS'
"use strict";

function applyTransaction(state, operations) {
  const workingState = { ...state };
  const events = [{ type: "transaction.started", operationCount: operations.length }];

  for (const operation of operations) {
    if (!Number.isInteger(operation.amount) || operation.amount <= 0) {
      return {
        ok: false,
        state: { ...state },
        events: [...events, { type: "transaction.rolled_back", reason: "invalid_amount" }],
        error: "invalid_amount",
      };
    }
    if (operation.type === "debit") {
      if (operation.amount > workingState.balance) {
        return {
          ok: false,
          state: { ...state },
          events: [...events, { type: "transaction.rolled_back", reason: "insufficient_funds" }],
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
        state: { ...state },
        events: [...events, { type: "transaction.rolled_back", reason: "unknown_operation" }],
        error: "unknown_operation",
      };
    }
  }

  workingState.version += 1;
  events.push({ type: "transaction.committed", version: workingState.version });
  return { ok: true, state: workingState, events };
}

module.exports = { applyTransaction };
JS
