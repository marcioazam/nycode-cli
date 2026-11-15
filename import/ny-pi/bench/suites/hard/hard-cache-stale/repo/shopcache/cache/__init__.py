"""Fábrica do cache com a manutenção ligada à pressão de capacidade."""

from shopcache.cache.maintenance import compact
from shopcache.cache.store import Cache


def make_cache(clock, max_entries: int = 1000, ttl: int = 300) -> Cache:
    cache = Cache(clock, max_entries=max_entries, ttl=ttl)
    cache.on_pressure = compact
    return cache
