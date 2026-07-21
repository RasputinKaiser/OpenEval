#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: gets the century rule in the wrong order — checks % 100
# before % 400 — so 2000 returns false instead of true. The literal "400"
# satisfies file_contains, but tests_pass and the isLeapYear(2000)===true
# exit_code check must reject it.
cat > lib/leap.js <<'JS'
function isLeapYear(year) {
  if (year % 100 === 0) return false;
  if (year % 400 === 0) return true;
  return year % 4 === 0;
}
module.exports = { isLeapYear };
JS
