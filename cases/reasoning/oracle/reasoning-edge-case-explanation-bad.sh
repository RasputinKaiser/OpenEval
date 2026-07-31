#!/usr/bin/env bash
set -euo pipefail
explanation='The bug is variable shadowing caused by the destructuring assignment. The temporary value of `a` is lost before it can be added, so the sequence uses stale data. The fix is to avoid destructuring by introducing a temporary variable.'
function='function fib(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i < n; i++) {
    let c = a + b;
    a = b;
    b = c;
  }
  return b;
}'
printf '%s\n' "$function" > fib-fixed.js
printf '%s\n\n```javascript\n%s\n```\n' "$explanation" "$function"
