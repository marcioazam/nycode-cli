from shopcache.app import build_app
from shopcache.cache import make_cache
from shopcache.cache.keys import make_key
from shopcache.cache.maintenance import compact
from shopcache.services.admin import nightly
from shopcache.util.clock import ManualClock


def mk(max_entries=1000, ttl=10):
    clock = ManualClock()
    return clock, make_cache(clock, max_entries=max_entries, ttl=ttl)


def K(t="t1", i="A", view="full"):
    return make_key(t, "price", i, view)


def test_tenant_invalidation_survives_compact():
    _, c = mk()
    c.put(K(), 1)
    c.invalidate_tenant("t1")
    compact(c)
    assert c.get(K()) is None


def test_entity_invalidation_survives_compact_all_views():
    _, c = mk()
    c.put(K(), 1)
    c.put(K(view="summary"), 2)
    c.invalidate_entity("t1", "price", "A")
    compact(c)
    assert c.get(K()) is None and c.get(K(view="summary")) is None


def test_invalidation_survives_capacity_pressure():
    _, c = mk(max_entries=3)
    c.put(K(), 1)
    c.invalidate_tenant("t1")
    for i in "xyz":
        c.put(K("t2", i), i)
    assert c.get(K()) is None
    assert [c.get(K("t2", i)) for i in "xyz"] == ["x", "y", "z"]


def test_reput_after_invalidate_and_compact_then_invalidate_again():
    _, c = mk()
    c.put(K(), 1)
    c.invalidate_tenant("t1")
    compact(c)
    c.put(K(), 2)
    assert c.get(K()) == 2
    c.invalidate_tenant("t1")
    assert c.get(K()) is None
    compact(c)
    assert c.get(K()) is None


def test_two_invalidation_rounds_with_compact_between():
    _, c = mk()
    c.put(K(), 1)
    c.invalidate_entity("t1", "price", "A")
    compact(c)
    c.put(K(), 2)
    c.invalidate_entity("t1", "price", "A")
    compact(c)
    assert c.get(K()) is None


def test_other_tenant_untouched_by_compact():
    _, c = mk()
    c.put(K("t1"), 1)
    c.put(K("t2"), 2)
    c.invalidate_tenant("t1")
    compact(c)
    assert (c.get(K("t1")), c.get(K("t2"))) == (None, 2)


def make_app():
    app = build_app(ttl=1000)
    for t in ("t1", "t2"):
        app.tenants.add(t, "EUR")
        app.products.add(t, "A", "Alpha", "x", 1000)
    app.orders.add("t1", "o1", [("A", 3)])
    return app


def test_service_bulk_reprice_then_nightly():
    app = make_app()
    assert app.pricing.price("t1", "A")["amount"] == 1000
    app.pricing.bulk_reprice("t1", 10)
    nightly(app.cache)
    assert app.pricing.price("t1", "A")["amount"] == 1100
    assert app.pricing.price("t1", "A", "summary") == "A: 11.00 EUR"
    assert app.order_service.total("t1", "o1") == 3300


def test_service_set_price_then_nightly():
    app = make_app()
    app.pricing.price("t1", "A")
    app.pricing.price("t1", "A", "summary")
    app.pricing.set_price("t1", "A", 1300)
    nightly(app.cache)
    assert app.pricing.price("t1", "A")["amount"] == 1300
    assert app.pricing.price("t1", "A", "summary") == "A: 13.00 EUR"


def test_service_stale_through_capacity_pressure():
    app = build_app(max_entries=3, ttl=1000)
    app.tenants.add("t1")
    app.tenants.add("t2")
    for t in ("t1", "t2"):
        for sku in ("A", "B", "C"):
            app.products.add(t, sku, sku, "x", 100)
    app.pricing.price("t1", "A")
    app.pricing.bulk_reprice("t1", 50)
    for sku in ("A", "B", "C"):
        app.pricing.price("t2", sku)
    assert app.pricing.price("t1", "A")["amount"] == 150


def test_ttl_boundary_is_inclusive():
    clock, c = mk(ttl=10)
    c.put(K(), 1)
    clock.advance(10)
    assert c.get(K()) == 1
    clock.advance(1)
    assert c.get(K()) is None


def test_compact_leaves_only_valid_entries():
    clock, c = mk(ttl=10)
    c.put(K(i="old"), 1)
    clock.advance(6)
    c.put(K(i="stale"), 2)
    c.put(K("t2", "ok"), 3)
    clock.advance(5)
    c.invalidate_entity("t1", "price", "stale")
    compact(c)
    assert len(c) == 1 and c.get(K("t2", "ok")) == 3
    assert c.snapshot_stats()["purged"] == 1


def test_counters_released_only_for_groups_without_entries():
    _, c = mk()
    c.put(K("t1", "A"), 1)
    c.invalidate_tenant("t1")
    c.put(K("t1", "B"), 2)
    c.put(K("t2", "Z"), 9)
    c.invalidate_tenant("t2")
    compact(c)
    stats = c.snapshot_stats()
    assert stats["entries"] == 1 and c.get(K("t1", "B")) == 2
    assert stats["tenant_epochs"] == 1


def test_entity_counters_released_when_entity_has_no_entries():
    _, c = mk()
    c.put(K(i="A"), 1)
    c.invalidate_entity("t1", "price", "A")
    compact(c)
    assert c.snapshot_stats()["entity_epochs"] == 0 and len(c) == 0


def test_eviction_drops_oldest_valid_after_purge():
    _, c = mk(ttl=100)
    for i in "abc":
        c.put(K(i=i), i)
    c.invalidate_entity("t1", "price", "a")
    c.max_entries = 1
    compact(c)
    assert len(c) == 1 and c.get(K(i="c")) == "c"
    assert c.snapshot_stats()["evicted"] == 1


def test_snapshot_stats_keys():
    _, c = mk()
    assert set(c.snapshot_stats()) == {
        "entries",
        "hits",
        "misses",
        "purged",
        "evicted",
        "tenant_epochs",
        "entity_epochs",
    }
