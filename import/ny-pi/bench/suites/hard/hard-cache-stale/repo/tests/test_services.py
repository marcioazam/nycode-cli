from shopcache.app import build_app
from shopcache.services.admin import nightly


def setup():
    app = build_app(ttl=100)
    app.tenants.add("t1", "EUR")
    app.tenants.add("t2", "USD")
    for t in ("t1", "t2"):
        app.products.add(t, "A", "Alpha", "x", 1000)
        app.products.add(t, "B", "Beta", "y", 250)
    app.orders.add("t1", "o1", [("A", 2), ("B", 1)])
    return app


def test_price_views_and_cache():
    app = setup()
    assert app.pricing.price("t1", "A") == {
        "sku": "A",
        "amount": 1000,
        "currency": "EUR",
    }
    assert app.pricing.price("t1", "A", "summary") == "A: 10.00 EUR"
    assert app.cache.stats.misses == 2


def test_set_price_invalidates():
    app = setup()
    app.pricing.price("t1", "A")
    app.pricing.set_price("t1", "A", 1200)
    assert app.pricing.price("t1", "A")["amount"] == 1200


def test_bulk_reprice_before_maintenance():
    app = setup()
    app.pricing.price("t1", "A")
    app.pricing.bulk_reprice("t1", 10)
    assert app.pricing.price("t1", "A")["amount"] == 1100


def test_order_total_and_rename():
    app = setup()
    assert app.order_service.total("t1", "o1") == 2250
    assert app.catalog.details("t1", "A")["name"] == "Alpha"
    app.catalog.rename("t1", "A", "Alfa")
    assert app.catalog.details("t1", "A")["name"] == "Alfa"


def test_nightly_stats():
    app = setup()
    app.pricing.price("t1", "A")
    stats = nightly(app.cache)
    assert stats["entries"] == 1
