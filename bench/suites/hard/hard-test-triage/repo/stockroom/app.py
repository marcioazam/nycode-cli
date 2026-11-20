"""Fachada: catálogo, depósitos e pedidos de uma instalação."""

from __future__ import annotations

from collections.abc import Iterable

from stockroom.catalog.products import Catalog, Product
from stockroom.catalog.sku import normalize_sku
from stockroom.errors import DuplicateError, NotFoundError
from stockroom.inventory.warehouse import Warehouse
from stockroom.orders.order import Order
from stockroom.orders.totals import Totals, order_totals
from stockroom.reports.lowstock import low_stock
from stockroom.reports.render import render_table
from stockroom.util.ids import next_id


class App:
    def __init__(self) -> None:
        self.catalog = Catalog()
        self._warehouses: dict[str, Warehouse] = {}
        self._orders: dict[str, Order] = {}

    def add_product(self, sku: str, name: str, price: int, **extra: int) -> Product:
        return self.catalog.add(Product(sku, name, price, **extra))

    def add_warehouse(self, name: str) -> Warehouse:
        if name in self._warehouses:
            raise DuplicateError(f"depósito já existe: {name}")
        self._warehouses[name] = Warehouse(name)
        return self._warehouses[name]

    def warehouse(self, name: str) -> Warehouse:
        if name not in self._warehouses:
            raise NotFoundError(f"depósito desconhecido: {name}")
        return self._warehouses[name]

    def create_order(self, lines: Iterable[tuple[str, int]]) -> Order:
        """Cria um pedido em rascunho; todo SKU tem de estar no catálogo."""
        pairs = [(self.catalog.get(sku).sku, qty) for sku, qty in lines]
        order = Order(next_id("ORD"))
        for sku, qty in pairs:
            order.add_line(sku, qty)
        self._orders[order.id] = order
        return order

    def order(self, order_id: str) -> Order:
        if order_id not in self._orders:
            raise NotFoundError(f"pedido desconhecido: {order_id}")
        return self._orders[order_id]

    def totals(self, order_id: str) -> Totals:
        return order_totals(self.order(order_id).lines, self.catalog)

    def available(self, warehouse: str, sku: str) -> int:
        return self.warehouse(warehouse).available(normalize_sku(sku))

    def low_stock_report(self, warehouse: str) -> str:
        rows = low_stock(self.catalog, self.warehouse(warehouse))
        return render_table(
            ["sku", "nome", "disp", "ponto", "comprar"],
            [(r.sku, r.name, r.available, r.reorder_point, r.suggested) for r in rows],
        )
