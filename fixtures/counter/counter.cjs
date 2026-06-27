function makeCounter(start = 0) {
  let count = start;
  return {
    next() { return ++count; },
    reset() { count = start; return count; },
    value() { return count; },
  };
}
module.exports = { makeCounter };
