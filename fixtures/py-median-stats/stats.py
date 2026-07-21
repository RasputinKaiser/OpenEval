"""Small statistics helpers."""


def median(nums):
    """Return the median of a non-empty list of numbers.

    BUG: for even-length inputs this returns the upper-middle element
    instead of the average of the two middle elements.
    """
    s = sorted(nums)
    return s[len(s) // 2]
