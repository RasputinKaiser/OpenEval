const { sum } = require("./math");
function variance(arr) {
  if (arr.length < 2) return 0;
  const avg = sum(arr) / arr.length;
  let s = 0;
  for (const x of arr) s = s + (x - avg) ** 2;
  // bug: forgot to divide by n
  return s;
}
module.exports = { variance };
