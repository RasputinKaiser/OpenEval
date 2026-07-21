#!/usr/bin/env bash
# Known-bad: an off-by-one "fix" that returns the lower-middle element for
# even-length lists. Still wrong (median([1,2,3,4]) -> 2, not 2.5) so the
# graders must reject it.
cat > stats.py <<'PY'
"""Small statistics helpers."""


def median(nums):
    s = sorted(nums)
    return s[len(s) // 2 - 1]
PY
