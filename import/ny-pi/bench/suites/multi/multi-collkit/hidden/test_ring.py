import pytest
from ring import RingBuffer


def test_fill_and_wrap():
    r = RingBuffer(3)
    assert r.to_list() == [] and len(r) == 0 and not r.is_full()
    for i in (1, 2):
        r.append(i)
    assert r.to_list() == [1, 2] and not r.is_full()
    r.append(3)
    assert r.is_full() and r.to_list() == [1, 2, 3]
    r.append(4)
    assert r.to_list() == [2, 3, 4] and len(r) == 3
    for i in range(5, 12):
        r.append(i)
    assert r.to_list() == [9, 10, 11]


def test_size_one():
    r = RingBuffer(1)
    r.append("a")
    r.append("b")
    assert r.to_list() == ["b"] and r.is_full()


def test_none_values_kept():
    r = RingBuffer(2)
    r.append(None)
    assert len(r) == 1 and r.to_list() == [None]


@pytest.mark.parametrize("n", [0, -1])
def test_bad(n):
    with pytest.raises(ValueError):
        RingBuffer(n)
