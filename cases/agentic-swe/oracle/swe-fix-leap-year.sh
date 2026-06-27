#!/usr/bin/env bash
cat > lib/leap.js <<'JS'
function isLeapYear(year) {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}
module.exports = { isLeapYear };
JS
