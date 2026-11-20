"""Diário: coleção ordenada de lançamentos."""

from collections.abc import Iterator

from ledger.model.entry import Entry


class Journal:
    def __init__(self) -> None:
        self._entries: dict[str, Entry] = {}

    def add(self, entry: Entry) -> None:
        if entry.id in self._entries:
            raise ValueError(f"id duplicado: {entry.id}")
        self._entries[entry.id] = entry

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self) -> Iterator[Entry]:
        return iter(sorted(self._entries.values(), key=lambda e: (e.date, e.id)))

    def by_kind(self, kind: str) -> list[Entry]:
        return [e for e in self if e.kind == kind]

    def by_account(self, account: str) -> list[Entry]:
        return [e for e in self if e.account == account]
