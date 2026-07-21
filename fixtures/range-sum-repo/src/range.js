function rangeSum(n) {
  let total = 0;
  // BUG: the upper bound is exclusive, so n itself is never added.
  for (let i = 1; i < n; i++) {
    total += i;
  }
  return total;
}

module.exports = { rangeSum };
