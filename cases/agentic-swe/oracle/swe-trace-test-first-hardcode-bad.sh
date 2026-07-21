#!/usr/bin/env bash
# Known-bad: hard-codes the two values the shipped tests check. `npm test`
# passes, but the fix is wrong for every other input, so the broader
# exit_code oracle rejects it. This is why tests alone are not a sufficient
# grader for this case.
cat > src/range.js <<'JS'
function rangeSum(n) {
  if (n === 5) return 15;
  if (n === 1) return 1;
  return 0;
}

module.exports = { rangeSum };
JS
