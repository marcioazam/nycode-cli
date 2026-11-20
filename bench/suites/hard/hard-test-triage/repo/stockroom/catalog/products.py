"""Produtos e catálogo (SPEC 1 e 2)."""

from __future__ import annotations

from dataclasses import dataclass

from stockroom.catalog.sku import normalize_sku
from stockroom.errors import DuplicateError, NotFoundError, ValidationError
from stockroom.util.money import check_cents


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    price: int  # centavos, preço de venda por unidade
    cost: int = 0  # centavos, custo por unidade
    pack_size: int = 1
    weight_g: int = 0
    reorder_point: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "sku", normalize_sku(self.sku))
        if not self.name.strip():
            raise ValidationError("nome vazio")
        check_cents(self.price, "price")
        check_cents(self.cost, "cost")
        if self.pack_size < 1:
            raise ValidationError("pack_size deve ser >= 1")
        if self.weight_g < 0 or self.reorder_point < 0:
            raise ValidationError("weight_g e reorder_point devem ser >= 0")


class Catalog:
    def __init__(self) -> None:
        self._items: dict[str, Product] = {}

    def add(self, product: Product) -> Product:
        if product.sku in self._items:
            raise DuplicateError(f"SKU já cadastrado: {product.sku}")
        self._items[product.sku] = product
        return product

    def get(self, sku: str) -> Product:
        key = normalize_sku(sku)
        if key not in self._items:
            raise NotFoundError(f"SKU desconhecido: {key}")
        return self._items[key]

    def __contains__(self, sku: str) -> bool:
        try:
            return normalize_sku(sku) in self._items
        except ValidationError:
            return False

    def __len__(self) -> int:
        return len(self._items)

    def all(self) -> list[Product]:
        """Produtos em ordem de SKU."""
        return [self._items[k] for k in sorted(self._items)]
