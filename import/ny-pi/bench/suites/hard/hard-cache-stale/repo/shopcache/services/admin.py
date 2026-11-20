"""Tarefas administrativas."""

from shopcache.cache.maintenance import compact


def nightly(cache) -> dict[str, int]:
    """Manutenção noturna; devolve as estatísticas do cache."""
    compact(cache)
    return cache.snapshot_stats()
