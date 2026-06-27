#!/usr/bin/env bash
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
cat > lib/stats.js <<'JS'
const { sum } = require("./math");
function variance(arr) {
  if (arr.length < 2) return 0;
  const avg = sum(arr) / arr.length;
  let s = 0;
  for (const x of arr) s = s + (x - avg) ** 2;
  return s / arr.length;
}
module.exports = { variance };
JS
