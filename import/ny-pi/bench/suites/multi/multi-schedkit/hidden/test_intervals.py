import pytest
from intervals import merge


def test_merge():
    assert merge([]) == []
    assert merge([(1, 3), (2, 6), (8, 10), (15, 18)]) == [(1, 6), (8, 10), (15, 18)]
    assert merge([(1, 4), (4, 5)]) == [(1, 5)]
    assert merge([(5, 6), (1, 2)]) == [(1, 2), (5, 6)]
    assert merge([(1, 10), (2, 3), (4, 5)]) == [(1, 10)]
    assert merge([(3, 3), (3, 3)]) == [(3, 3)]
    assert merge([(1, 2), (3, 4)]) == [(1, 2), (3, 4)]


def test_input_untouched():
    data = [(5, 6), (1, 5)]
    merge(data)
    assert data == [(5, 6), (1, 5)]


def test_bad():
    with pytest.raises(ValueError):
        merge([(1, 2), (5, 4)])
