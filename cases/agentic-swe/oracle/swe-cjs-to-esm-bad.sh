#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: creates counter.mjs with the right export shape
# (satisfies file_exists + file_contains) but next() uses post-increment
# so it returns the pre-increment value. tests_pass must reject it.
cat > counter.mjs <<'JS'
export function makeCounter(start = 0) {
  let count = start;
  return {
    next() { return count++; },
    reset() { count = start; return count; },
    value() { return count; },
  };
}
JS
