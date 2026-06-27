#!/usr/bin/env bash
cat > src/fizzbuzz.js <<'JS'
function fizzbuzz(n) {
  let out = "";
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) out += "FizzBuzz";
    else if (i % 3 === 0) out += "Fizz";
    else if (i % 5 === 0) out += "Buzz";
    else out += String(i);
    if (i < n) out += ",";
  }
  return out;
}
module.exports = { fizzbuzz };
JS
