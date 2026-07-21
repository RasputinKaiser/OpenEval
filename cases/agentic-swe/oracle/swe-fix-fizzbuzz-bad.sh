#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: hard-codes the single example from the prompt (i === 15)
# instead of the general i % 15 === 0 rule. 15 becomes FizzBuzz but 30 stays
# "Fizz". The "FizzBuzz" literal satisfies file_contains, but tests_pass and
# the p[29]==='FizzBuzz' exit_code check must reject it.
cat > src/fizzbuzz.js <<'JS'
function fizzbuzz(n) {
  let out = "";
  for (let i = 1; i <= n; i++) {
    if (i === 15) out += "FizzBuzz";
    else if (i % 3 === 0) out += "Fizz";
    else if (i % 5 === 0) out += "Buzz";
    else out += String(i);
    if (i < n) out += ",";
  }
  return out;
}
module.exports = { fizzbuzz };
JS
