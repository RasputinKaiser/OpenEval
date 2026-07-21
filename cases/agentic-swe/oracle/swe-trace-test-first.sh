#!/usr/bin/env bash
# Correct fix: make the loop bound inclusive so n is added to the sum.
cat > src/range.js <<'JS'
function rangeSum(n) {
  let total = 0;
  for (let i = 1; i <= n; i++) {
    total += i;
  }
  return total;
}

module.exports = { rangeSum };
JS
