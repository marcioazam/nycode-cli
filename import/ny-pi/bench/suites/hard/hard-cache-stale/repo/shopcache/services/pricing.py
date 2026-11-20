"""Preços com leitura através do cache."""

from shopcache.cache.keys import make_key
from shopcache.events.bus import Bus
from shopcache.repo.products import ProductRepo
from shopcache.repo.tenants import TenantRepo
from shopcache.util.validate import require_positive_int


class PricingService:
    def __init__(
        self, products: ProductRepo, tenants: TenantRepo, cache, bus: Bus
    ) -> None:
        self._products, self._tenants, self._cache, self._bus = (
            products,
            tenants,
            cache,
            bus,
        )

    def price(self, tenant: str, sku: str, view: str = "full"):
        key = make_key(tenant, "price", sku, view)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        row = self._products.get(tenant, sku)
        if row is None:
            raise KeyError(sku)
        currency = self._tenants.currency(tenant)
        value = (
            {"sku": sku, "amount": row["price"], "currency": currency}
            if view == "full"
            else f"{sku}: {row['price'] / 100:.2f} {currency}"
        )
        self._cache.put(key, value)
        return value

    def set_price(self, tenant: str, sku: str, price: int) -> None:
        require_positive_int(price, "price")
        self._products.set_price(tenant, sku, price)
        self._bus.publish("price_changed", {"tenant": tenant, "sku": sku})

    def bulk_reprice(self, tenant: str, percent: int) -> None:
        for sku in self._products.skus(tenant):
            row = self._products.get(tenant, sku)
            self._products.set_price(tenant, sku, row["price"] * (100 + percent) // 100)
        self._bus.publish("tenant_repriced", {"tenant": tenant})
