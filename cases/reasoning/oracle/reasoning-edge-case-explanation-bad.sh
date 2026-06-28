#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
The bug is variable shadowing caused by the destructuring assignment. The temporary value of `a` is lost before it can be added, so the sequence uses stale data. The fix is to avoid destructuring by introducing a temporary variable.

```javascript
function fib(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i < n; i++) {
    let c = a + b;
    a = b;
    b = c;
  }
  return b;
}
```
EOF
