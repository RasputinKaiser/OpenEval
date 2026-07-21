from stats import median


def test_median_odd_length():
    assert median([1, 2, 3]) == 2
    assert median([5]) == 5


def test_median_even_length():
    assert median([1, 2, 3, 4]) == 2.5
    assert median([7, 1, 3, 5]) == 4.0


def test_median_unsorted_input():
    assert median([3, 1, 2]) == 2
    assert median([10, 2, 8, 4]) == 6.0
