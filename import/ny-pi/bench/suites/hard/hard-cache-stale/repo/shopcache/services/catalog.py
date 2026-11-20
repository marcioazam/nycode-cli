"""Detalhes de produto com leitura através do cache."""

from shopcache.cache.keys import make_key


class CatalogService:
    def __init__(self, products, cache, bus) -> None:
        self._products, self._cache, self._bus = products, cache, bus

    def details(self, tenant: str, sku: str) -> dict:
        key = make_key(tenant, "product", sku)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        row = self._products.get(tenant, sku)
        if row is None:
            raise KeyError(sku)
        value = {"sku": sku, "name": row["name"], "category": row["category"]}
        self._cache.put(key, value)
        return value

    def rename(self, tenant: str, sku: str, name: str) -> None:
        row = self._products.get(tenant, sku)
        if row is None:
            raise KeyError(sku)
        self._products.add(tenant, sku, name, row["category"], row["price"])
        self._bus.publish("product_changed", {"tenant": tenant, "sku": sku})
