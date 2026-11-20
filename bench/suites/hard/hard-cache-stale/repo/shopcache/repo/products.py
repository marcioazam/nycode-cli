"""Produtos: nome, categoria e preço em centavos."""

from shopcache.repo.memory_db import Db


class ProductRepo:
    def __init__(self, db: Db) -> None:
        self._db = db

    def add(self, tenant: str, sku: str, name: str, category: str, price: int) -> None:
        self._db.put(
            "product",
            tenant,
            sku,
            {"sku": sku, "name": name, "category": category, "price": price},
        )

    def get(self, tenant: str, sku: str) -> dict | None:
        row = self._db.get("product", tenant, sku)
        return dict(row) if row else None

    def set_price(self, tenant: str, sku: str, price: int) -> None:
        row = self.get(tenant, sku)
        if row is None:
            raise KeyError(sku)
        row["price"] = price
        self._db.put("product", tenant, sku, row)

    def skus(self, tenant: str) -> list[str]:
        return self._db.ids("product", tenant)
