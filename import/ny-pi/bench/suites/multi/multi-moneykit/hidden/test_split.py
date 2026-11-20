import pytest
from split import allocate, split_evenly


def test_even():
    assert split_evenly(100, 3) == [34, 33, 33]
    assert split_evenly(10, 5) == [2] * 5
    assert split_evenly(1, 3) == [1, 0, 0]
    assert split_evenly(0, 4) == [0, 0, 0, 0]
    assert split_evenly(7, 1) == [7]
    assert split_evenly(-100, 3) == [-34, -33, -33]


def test_allocate():
    assert allocate(100, [50, 30, 20]) == [50, 30, 20]
    assert allocate(10, [0, 1]) == [0, 10]
    assert allocate(5, [1, 1]) == [3, 2]
    assert allocate(100, [1, 1, 1]) == [34, 33, 33]
    assert allocate(10, [1, 2]) == [3, 7]  # restos .33 e .67: sobra vai ao segundo
    assert allocate(-10, [1, 2]) == [-3, -7]


def test_sum_invariant():
    for total in (0, 1, 99, 1000, 12345):
        for w in ([1, 2, 3], [5, 0, 5], [7], [1, 1, 1, 1, 1, 1, 1]):
            r = allocate(total, w)
            assert sum(r) == total and len(r) == len(w) and all(x >= 0 for x in r)


@pytest.mark.parametrize("w", [[], [0, 0], [1, -1, 3]])
def test_bad_weights(w):
    with pytest.raises(ValueError):
        allocate(100, w)


@pytest.mark.parametrize("p", [0, -2])
def test_bad_parts(p):
    with pytest.raises(ValueError):
        split_evenly(100, p)
