"""Total de pedido calculado a partir dos preços em cache."""


class OrderService:
    def __init__(self, orders, pricing) -> None:
        self._orders, self._pricing = orders, pricing

    def total(self, tenant: str, order_id: str) -> int:
        order = self._orders.get(tenant, order_id)
        if order is None:
            raise KeyError(order_id)
        return sum(
            self._pricing.price(tenant, sku)["amount"] * qty
            for sku, qty in order["items"]
        )
