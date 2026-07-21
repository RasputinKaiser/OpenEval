"""Test suite for stats.median.

Pure standard-library so it runs anywhere (no pytest dependency). Emits
TAP-style output that OpenEval's tests_pass grader parses ("# pass N" /
"# fail N"), and exits nonzero if any assertion fails. Do not modify.
"""
import sys

from stats import median

CASES = [
    ("odd length", lambda: median([1, 2, 3]) == 2),
    ("single element", lambda: median([5]) == 5),
    ("even length averages the two middles", lambda: median([1, 2, 3, 4]) == 2.5),
    ("even length, unsorted input", lambda: median([7, 1, 3, 5]) == 4.0),
    ("odd length, unsorted input", lambda: median([3, 1, 2]) == 2),
    ("even length, unsorted input (2)", lambda: median([10, 2, 8, 4]) == 6.0),
]


def main():
    passed = 0
    failed = 0
    print("1..%d" % len(CASES))
    for i, (name, check) in enumerate(CASES, 1):
        try:
            outcome = bool(check())
        except Exception as exc:  # noqa: BLE001 - a raised error is a failed test
            outcome = False
            name = "%s (raised %s)" % (name, type(exc).__name__)
        if outcome:
            passed += 1
            print("ok %d - %s" % (i, name))
        else:
            failed += 1
            print("not ok %d - %s" % (i, name))
    print("# pass %d" % passed)
    print("# fail %d" % failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
