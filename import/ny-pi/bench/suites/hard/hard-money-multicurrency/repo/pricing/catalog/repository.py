"""In-memory product catalog."""

from pricing.catalog.product import Product
from pricing.errors import UnknownProductError


class Catalog:
    def __init__(self) -> None:
        self._products: dict[str, Product] = {}

    def add(self, product: Product) -> Product:
        self._products[product.sku] = product
        return product

    def get(self, sku: str) -> Product:
        try:
            return self._products[sku]
        except KeyError:
            raise UnknownProductError(sku) from None

    def skus(self) -> list[str]:
        return sorted(self._products)

    def by_category(self, category: str) -> list[Product]:
        return [p for _, p in sorted(self._products.items()) if p.category == category]
