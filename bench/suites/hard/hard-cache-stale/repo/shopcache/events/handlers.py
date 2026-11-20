"""Ligações evento → invalidação de cache."""

from shopcache.cache.store import Cache
from shopcache.events.bus import Bus


def register(bus: Bus, cache: Cache) -> None:
    bus.subscribe(
        "price_changed",
        lambda p: cache.invalidate_entity(p["tenant"], "price", p["sku"]),
    )
    bus.subscribe(
        "product_changed",
        lambda p: cache.invalidate_entity(p["tenant"], "product", p["sku"]),
    )
    bus.subscribe("tenant_repriced", lambda p: cache.invalidate_tenant(p["tenant"]))
