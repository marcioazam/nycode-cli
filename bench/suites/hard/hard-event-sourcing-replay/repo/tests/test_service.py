from helpers import ev
from stockflow.services import InventoryService
from stockflow.services.reports import low_stock, order_summary


def make_service():
    svc = InventoryService()
    svc.record_many(
        [
            ev("e1", "sku:A", 1, "stock_received", {"qty": 10}),
            ev("e2", "sku:A", 2, "stock_reserved", {"qty": 7, "reservation_id": "r"}),
            ev("e3", "sku:B", 1, "stock_received", {"qty": 50}),
            ev("o1", "order:9", 1, "order_placed", {"lines": []}),
        ]
    )
    return svc


def test_stock_level_and_order_status():
    svc = make_service()
    assert svc.stock_level("A") == {"on_hand": 10, "reserved": 7, "available": 3}
    assert svc.stock_level("nope") == {"on_hand": 0, "reserved": 0, "available": 0}
    assert svc.order_status("9") == "placed" and svc.order_status("1") is None


def test_reports():
    svc = make_service()
    assert low_stock(svc.store, 10) == ["A"]
    assert order_summary(svc.store) == {"placed": 1}
