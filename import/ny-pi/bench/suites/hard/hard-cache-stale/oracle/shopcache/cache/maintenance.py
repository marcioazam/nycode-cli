"""Manutenção do cache: expira entradas, reclama contadores e respeita a capacidade."""

from shopcache.cache.store import Cache
from shopcache.cache.ttl import is_expired


def compact(cache: Cache) -> None:
    now = cache.clock.now()
    for key, entry in cache.raw_items():
        if is_expired(entry.expires_at, now):
            cache.drop(key)
            cache.stats.purged += 1
        elif not cache.is_valid(key, entry):
            # Invalidada: remover antes de esquecer os contadores, senão ela ressuscita.
            cache.drop(key)
    overflow = len(cache) - cache.max_entries
    if overflow > 0:
        oldest = sorted(cache.raw_items(), key=lambda item: item[1].seq)[:overflow]
        for key, _ in oldest:
            cache.drop(key)
            cache.stats.evicted += 1
    # Só restam entradas válidas: contadores de grupos sem entradas podem ser liberados.
    rest = [k for k, _ in cache.raw_items()]
    cache.epochs.retain({k.tenant for k in rest}, {k.entity for k in rest})
