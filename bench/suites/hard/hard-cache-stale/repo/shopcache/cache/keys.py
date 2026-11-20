"""Chave composta do cache: (tenant, tipo, id, visão)."""

from typing import NamedTuple


class Key(NamedTuple):
    tenant: str
    kind: str
    ident: str
    view: str = "full"

    @property
    def entity(self) -> tuple[str, str, str]:
        return (self.tenant, self.kind, self.ident)


def make_key(tenant: str, kind: str, ident: str, view: str = "full") -> Key:
    for part in (tenant, kind, ident, view):
        if not isinstance(part, str) or not part:
            raise ValueError("partes da chave devem ser strings não vazias")
    return Key(tenant, kind, ident, view)
