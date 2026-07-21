#!/usr/bin/env bash
cat > stats.py <<'PY'
"""Small statistics helpers."""


def median(nums):
    """Return the median of a non-empty list of numbers."""
    s = sorted(nums)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2
PY
