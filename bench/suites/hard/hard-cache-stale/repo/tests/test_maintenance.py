from shopcache.cache import make_cache
from shopcache.cache.keys import make_key
from shopcache.cache.maintenance import compact
from shopcache.util.clock import ManualClock


def test_compact_removes_expired():
    clock = ManualClock()
    c = make_cache(clock, ttl=10)
    c.put(make_key("t", "price", "A"), 1)
    clock.advance(5)
    c.put(make_key("t", "price", "B"), 2)
    clock.advance(6)
    compact(c)
    assert len(c) == 1 and c.stats.purged == 1


def test_compact_keeps_valid_and_counters():
    c = make_cache(ManualClock(), ttl=10)
    k = make_key("t", "price", "A")
    c.invalidate_entity("t", "price", "A")
    c.put(k, 1)
    compact(c)
    assert c.get(k) == 1
    assert c.snapshot_stats()["entity_epochs"] == 1


def test_capacity_evicts_oldest():
    c = make_cache(ManualClock(), max_entries=2, ttl=100)
    for i in "abc":
        c.put(make_key("t", "price", i), i)
    assert len(c) == 2
    assert c.get(make_key("t", "price", "a")) is None
    assert c.stats.evicted == 1
