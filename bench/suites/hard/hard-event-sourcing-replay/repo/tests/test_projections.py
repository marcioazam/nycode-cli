from helpers import ev
from stockflow.projections import applicable_projections, default_projections
from stockflow.projections.orders.status import OrderStatus
from stockflow.projections.stock.movements import HISTORY_SIZE, StockMovements


def test_applicable_projections_by_kind():
    names = [p.name for p in applicable_projections(default_projections(), "sku:A")]
    assert names == ["levels", "reservations", "movements", "counters", "last_seen"]
    names = [p.name for p in applicable_projections(default_projections(), "order:1")]
    assert names == ["status", "totals", "counters", "last_seen"]


def test_order_status_ignores_invalid_transition():
    proj = OrderStatus()
    state = proj.initial()
    proj.apply(state, ev("a", "order:1", 1, "order_shipped"))
    assert state == {"status": "new", "flags": {"ignored:order_shipped"}}


def test_movements_keep_last_five():
    proj = StockMovements()
    state = proj.initial()
    for i in range(1, 9):
        proj.apply(state, ev("e%d" % i, "sku:A", i, "stock_received", {"qty": i}))  # noqa: UP031
    assert state["count"] == 8 and len(state["history"]) == HISTORY_SIZE
    assert state["history"][0] == (4, "stock_received", 4)
