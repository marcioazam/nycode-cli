import pytest
from slots import free_slots


def test_basic():
    assert free_slots([], 9, 17) == [(9, 17)]
    assert free_slots([(10, 11), (13, 14)], 9, 17) == [(9, 10), (11, 13), (14, 17)]


def test_unsorted_overlap_touching():
    assert free_slots([(13, 15), (10, 12), (11, 13)], 9, 17) == [(9, 10), (15, 17)]
    assert free_slots([(10, 12), (12, 14)], 9, 17) == [(9, 10), (14, 17)]


def test_outside_window():
    assert free_slots([(0, 5), (20, 30)], 9, 17) == [(9, 17)]
    assert free_slots([(0, 10), (16, 30)], 9, 17) == [(10, 16)]
    assert free_slots([(0, 100)], 9, 17) == []
    assert free_slots([(9, 17)], 9, 17) == []
    assert free_slots([(17, 20)], 9, 17) == [(9, 17)]


def test_zero_length_busy_and_gaps():
    assert free_slots([(10, 10)], 9, 17) == [(9, 17)]
    assert free_slots([(9, 12), (12, 17)], 9, 17) == []


def test_bad():
    with pytest.raises(ValueError):
        free_slots([], 5, 5)
    with pytest.raises(ValueError):
        free_slots([], 6, 5)
    with pytest.raises(ValueError):
        free_slots([(3, 2)], 0, 10)
