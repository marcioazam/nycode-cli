import pytest
from lru import LRUCache


def test_eviction_order():
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    c.put("c", 3)
    assert c.keys() == ["b", "c"]
    assert "a" not in c and len(c) == 2


def test_get_refreshes():
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == 1
    c.put("c", 3)
    assert c.keys() == ["a", "c"]


def test_contains_does_not_refresh():
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert "a" in c
    c.put("c", 3)
    assert "a" not in c


def test_update_refreshes_and_replaces():
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    c.put("a", 10)
    c.put("c", 3)
    assert c.get("a") == 10 and "b" not in c


def test_default_and_falsy_values():
    c = LRUCache(1)
    assert c.get("x") is None
    assert c.get("x", 7) == 7
    c.put("z", 0)
    assert c.get("z", 5) == 0
    assert c.get("z") == 0


@pytest.mark.parametrize("cap", [0, -3])
def test_bad_capacity(cap):
    with pytest.raises(ValueError):
        LRUCache(cap)
