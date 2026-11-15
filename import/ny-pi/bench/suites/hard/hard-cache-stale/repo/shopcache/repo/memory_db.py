"""Banco em memória: tabelas por tenant."""

from typing import Any


class Db:
    def __init__(self) -> None:
        self._tables: dict[tuple[str, str], dict[str, Any]] = {}
        self.reads = 0

    def get(self, table: str, tenant: str, ident: str) -> Any | None:
        self.reads += 1
        return self._tables.get((table, tenant), {}).get(ident)

    def put(self, table: str, tenant: str, ident: str, row: Any) -> None:
        self._tables.setdefault((table, tenant), {})[ident] = row

    def ids(self, table: str, tenant: str) -> list[str]:
        return sorted(self._tables.get((table, tenant), {}))
