"""Pedidos: itens (sku, quantidade)."""

from shopcache.repo.memory_db import Db


class OrderRepo:
    def __init__(self, db: Db) -> None:
        self._db = db

    def add(self, tenant: str, order_id: str, items: list[tuple[str, int]]) -> None:
        self._db.put("order", tenant, order_id, {"id": order_id, "items": list(items)})

    def get(self, tenant: str, order_id: str) -> dict | None:
        return self._db.get("order", tenant, order_id)
