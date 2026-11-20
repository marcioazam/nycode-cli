"""Armazenamento do cache com validação por TTL e por época."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from shopcache.cache.epochs import Epochs
from shopcache.cache.keys import Key
from shopcache.cache.stats import Stats
from shopcache.cache.ttl import expires_at, is_expired


@dataclass
class Entry:
    value: Any
    stamp: tuple[int, int]
    expires_at: int
    seq: int


class Cache:
    def __init__(self, clock, max_entries: int = 1000, ttl: int = 300) -> None:
        self.clock = clock
        self.max_entries = max_entries
        self.ttl = ttl
        self.epochs = Epochs()
        self.stats = Stats()
        self.on_pressure: Callable[[Cache], None] | None = None
        self._items: dict[Key, Entry] = {}
        self._seq = 0

    def is_valid(self, key: Key, entry: Entry) -> bool:
        if is_expired(entry.expires_at, self.clock.now()):
            return False
        return entry.stamp == self.epochs.stamp(key)

    def get(self, key: Key) -> Any | None:
        entry = self._items.get(key)
        if entry is None or not self.is_valid(key, entry):
            self.stats.misses += 1
            return None
        self.stats.hits += 1
        return entry.value

    def put(self, key: Key, value: Any, ttl: int | None = None) -> None:
        self._seq += 1
        life = self.ttl if ttl is None else ttl
        self._items[key] = Entry(
            value, self.epochs.stamp(key), expires_at(self.clock.now(), life), self._seq
        )
        if len(self._items) > self.max_entries and self.on_pressure is not None:
            self.on_pressure(self)

    def invalidate_entity(self, tenant: str, kind: str, ident: str) -> None:
        self.epochs.bump_entity((tenant, kind, ident))

    def invalidate_tenant(self, tenant: str) -> None:
        self.epochs.bump_tenant(tenant)

    def raw_items(self) -> list[tuple[Key, Entry]]:
        return list(self._items.items())

    def drop(self, key: Key) -> None:
        self._items.pop(key, None)

    def __len__(self) -> int:
        return len(self._items)

    def snapshot_stats(self) -> dict[str, int]:
        t, e = self.epochs.sizes()
        return {
            "entries": len(self._items),
            "hits": self.stats.hits,
            "misses": self.stats.misses,
            "purged": self.stats.purged,
            "evicted": self.stats.evicted,
            "tenant_epochs": t,
            "entity_epochs": e,
        }
