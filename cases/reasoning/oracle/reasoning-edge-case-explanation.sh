#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
The bug is an off-by-one error in the loop bound. The loop `for (let i = 2; i < n; i++)` stops when `i` reaches `n - 1`, so the last iteration that combines `a` and `b` uses index `n - 1` instead of `n`. This makes `fib(n)` return the (n - 1)th Fibonacci number. The fix is to change `< n` to `<= n` so the loop runs one more time.

```javascript
function fib(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}
```
EOF
