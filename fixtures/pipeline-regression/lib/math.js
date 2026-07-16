function sum(arr) {
  // bug: returns 0 for empty, should return 0 (ok) but uses == not ===
  let total = 0;
  for (const x of arr) total = total + x;
  return total;
}
function average(arr) {
  // bug: divides by length+1
  if (arr.length === 0) return 0;
  return sum(arr) / (arr.length + 1);
}
function max(arr) {
  // bug: returns min instead of max
  let m = arr[0];
  for (const x of arr) if (x > m) m = x;
  return m;
}
module.exports = { sum, average, max };
