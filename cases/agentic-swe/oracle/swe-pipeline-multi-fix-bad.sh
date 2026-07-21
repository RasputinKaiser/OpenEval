#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: long-horizon partial fix — corrects the two obvious bugs in
# lib/math.js (average count and max) but never touches lib/stats.js, leaving
# variance undivided. The math.js git_diff_contains grader passes, but the
# variance test fails (tests_pass, weight 60) and the stats.js diff grader
# fails, dropping the weighted score below pass_threshold 0.8.
cat > lib/math.js <<'JS'
function sum(arr) {
  let total = 0;
  for (const x of arr) total = total + x;
  return total;
}
function average(arr) {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
}
function max(arr) {
  let m = arr[0];
  for (const x of arr) if (x > m) m = x;
  return m;
}
module.exports = { sum, average, max };
JS
