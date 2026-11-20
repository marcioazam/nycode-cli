"""Manutenção do cache: expira entradas, reclama contadores e respeita a capacidade."""

from shopcache.cache.store import Cache
from shopcache.cache.ttl import is_expired


def compact(cache: Cache) -> None:
    now = cache.clock.now()
    for key, entry in cache.raw_items():
        if is_expired(entry.expires_at, now):
            cache.drop(key)
            cache.stats.purged += 1
    # Contadores só interessam a grupos que ainda têm entradas válidas.
    live = [k for k, e in cache.raw_items() if cache.is_valid(k, e)]
    cache.epochs.retain({k.tenant for k in live}, {k.entity for k in live})
    overflow = len(cache) - cache.max_entries
    if overflow > 0:
        oldest = sorted(cache.raw_items(), key=lambda item: item[1].seq)[:overflow]
        for key, _ in oldest:
            cache.drop(key)
            cache.stats.evicted += 1
