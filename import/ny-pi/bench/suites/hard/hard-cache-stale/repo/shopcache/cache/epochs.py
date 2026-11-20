"""Contadores de época: invalidação preguiçosa por tenant e por entidade."""


class Epochs:
    def __init__(self) -> None:
        self._tenant: dict[str, int] = {}
        self._entity: dict[tuple[str, str, str], int] = {}

    def tenant(self, tenant: str) -> int:
        return self._tenant.get(tenant, 0)

    def entity(self, entity: tuple[str, str, str]) -> int:
        return self._entity.get(entity, 0)

    def bump_tenant(self, tenant: str) -> None:
        self._tenant[tenant] = self.tenant(tenant) + 1

    def bump_entity(self, entity: tuple[str, str, str]) -> None:
        self._entity[entity] = self.entity(entity) + 1

    def stamp(self, key) -> tuple[int, int]:
        """Época atual (tenant, entidade) de uma chave."""
        return (self.tenant(key.tenant), self.entity(key.entity))

    def retain(self, tenants: set[str], entities: set[tuple[str, str, str]]) -> None:
        """Esquece contadores de grupos que não estão em `tenants`/`entities`."""
        self._tenant = {t: n for t, n in self._tenant.items() if t in tenants}
        self._entity = {e: n for e, n in self._entity.items() if e in entities}

    def sizes(self) -> tuple[int, int]:
        return (len(self._tenant), len(self._entity))
