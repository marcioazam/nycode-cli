import pytest
from shopcache.cache import make_cache
from shopcache.cache.keys import make_key
from shopcache.util.clock import ManualClock


def mk(max_entries=1000):
    clock = ManualClock()
    return clock, make_cache(clock, max_entries=max_entries, ttl=10)


def test_put_get_and_miss():
    _, c = mk()
    k = make_key("t1", "price", "A")
    assert c.get(k) is None
    c.put(k, 5)
    assert c.get(k) == 5
    assert (c.stats.hits, c.stats.misses) == (1, 1)


def test_ttl_expiry():
    clock, c = mk()
    k = make_key("t1", "price", "A")
    c.put(k, 5)
    clock.advance(11)
    assert c.get(k) is None


def test_key_validation():
    with pytest.raises(ValueError):
        make_key("", "price", "A")


def test_entity_invalidation_hits_all_views_only():
    _, c = mk()
    a, a2, b = (
        make_key("t", "price", "A"),
        make_key("t", "price", "A", "summary"),
        make_key("t", "price", "B"),
    )
    for k in (a, a2, b):
        c.put(k, 1)
    c.invalidate_entity("t", "price", "A")
    assert (c.get(a), c.get(a2), c.get(b)) == (None, None, 1)


def test_tenant_invalidation_isolated():
    _, c = mk()
    a, b = make_key("t1", "price", "A"), make_key("t2", "price", "A")
    c.put(a, 1)
    c.put(b, 2)
    c.invalidate_tenant("t1")
    assert (c.get(a), c.get(b)) == (None, 2)
