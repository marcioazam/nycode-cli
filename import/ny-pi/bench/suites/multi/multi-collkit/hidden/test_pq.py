import pytest
from pq import PriorityQueue


def test_order_and_fifo_ties():
    q = PriorityQueue()
    q.push("c", 2)
    q.push("a", 1)
    q.push("b", 1)
    assert [q.pop(), q.pop(), q.pop()] == ["a", "b", "c"]


def test_update_and_remove():
    q = PriorityQueue()
    for k, p in (("a", 5), ("b", 6), ("c", 7)):
        q.push(k, p)
    q.update("c", 1)
    q.remove("a")
    assert len(q) == 2 and "a" not in q and "c" in q
    assert q.pop() == "c"
    assert q.pop() == "b"
    with pytest.raises(IndexError):
        q.pop()


def test_push_existing_replaces():
    q = PriorityQueue()
    q.push("x", 1)
    q.push("x", 9)
    q.push("y", 5)
    assert len(q) == 2
    assert q.pop() == "y"
    assert q.pop() == "x"
    assert len(q) == 0


def test_removed_then_readded():
    q = PriorityQueue()
    q.push("x", 1)
    q.remove("x")
    q.push("x", 3)
    q.push("z", 2)
    assert q.pop() == "z"
    assert q.pop() == "x"


def test_missing_keys():
    q = PriorityQueue()
    with pytest.raises(KeyError):
        q.update("n", 1)
    with pytest.raises(KeyError):
        q.remove("n")


def test_uncomparable_items():
    q = PriorityQueue()
    q.push(frozenset([1]), 1)
    q.push((None,), 1)
    assert len(q) == 2
    assert q.pop() == frozenset([1])
