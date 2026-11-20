"""Serviço de estoque: grava eventos e consulta o estado."""

from ..projections.registry import default_projections
from ..replay.full import replay_aggregate, replay_all
from ..store.memory import InMemoryEventStore


class InventoryService:
    def __init__(self, store=None, projections=None):
        self.store = InMemoryEventStore() if store is None else store
        self.projections = (
            default_projections() if projections is None else list(projections)
        )

    def record(self, event):
        self.store.append(event)

    def record_many(self, events):
        self.store.extend(events)

    def state(self):
        """Estado completo: {aggregate_id: {nome_da_projeção: estado}}."""
        return replay_all(self.store, self.projections)

    def stock_level(self, sku):
        """{"on_hand", "reserved", "available"} do SKU (zeros se desconhecido)."""
        state = replay_aggregate(self.store, "sku:" + sku, self.projections)
        levels = state.get("levels", {"on_hand": 0, "reserved": 0})
        return {
            "on_hand": levels["on_hand"],
            "reserved": levels["reserved"],
            "available": levels["on_hand"] - levels["reserved"],
        }

    def order_status(self, order_id):
        """Status do pedido, ou None se o pedido não existe."""
        state = replay_aggregate(self.store, "order:" + order_id, self.projections)
        if "status" not in state:
            return None
        return state["status"]["status"]
