import pytest
from stockroom import App
from stockroom.errors import InsufficientStock, StateError
from stockroom.inventory.warehouse import Warehouse
from stockroom.orders.order import Order
from stockroom.util.ids import next_id, reset_ids


def _warehouse():
    wh = Warehouse("central")
    wh.receive("AB-100", 10)
    wh.receive("CD-200", 5)
    return wh


def test_cancel_confirmed_order_releases_reservations():
    wh = _warehouse()
    order = Order("ORD-H1")
    order.add_line("AB-100", 10)
    order.add_line("CD-200", 2)
    order.confirm(wh)
    assert (wh.available("AB-100"), wh.available("CD-200")) == (0, 3)
    order.cancel(wh)
    assert order.status == "cancelled"
    assert (wh.available("AB-100"), wh.available("CD-200")) == (10, 5)
    assert (wh.on_hand("AB-100"), wh.on_hand("CD-200")) == (10, 5)
    assert wh.reservations.reserved_for("ORD-H1") == {}


def test_cancel_leaves_other_orders_alone():
    wh = _warehouse()
    first, second = Order("ORD-H1"), Order("ORD-H2")
    first.add_line("AB-100", 4)
    second.add_line("AB-100", 6)
    first.confirm(wh)
    second.confirm(wh)
    first.cancel(wh)
    assert wh.available("AB-100") == 4
    assert wh.reservations.reserved_for("ORD-H2") == {"AB-100": 6}


def test_confirm_whole_stock_then_ship():
    wh = _warehouse()
    order = Order("ORD-H1")
    order.add_line("CD-200", 5)
    order.confirm(wh)
    other = Order("ORD-H2")
    other.add_line("AB-100", 1)
    other.add_line("CD-200", 1)
    with pytest.raises(InsufficientStock):
        other.confirm(wh)
    assert wh.available("AB-100") == 10
    order.ship(wh)
    assert (wh.on_hand("CD-200"), wh.available("CD-200")) == (0, 0)


def test_final_states():
    wh = _warehouse()
    order = Order("ORD-H1")
    order.add_line("AB-100", 2)
    order.confirm(wh)
    order.ship(wh)
    for action in (order.cancel, order.confirm, order.ship):
        with pytest.raises(StateError):
            action(wh)
    assert order.status == "shipped"
    assert wh.on_hand("AB-100") == 8


def test_order_ids_are_process_wide():
    first, second = App(), App()
    for app in (first, second):
        app.add_product("AB-100", "Parafuso", 250)
    ids = [
        first.create_order([("AB-100", 1)]).id,
        second.create_order([("AB-100", 1)]).id,
        first.create_order([("AB-100", 1)]).id,
    ]
    assert ids == ["ORD-000001", "ORD-000002", "ORD-000003"]
    assert next_id("ORD") == "ORD-000004"
    reset_ids()
    assert next_id("ORD") == "ORD-000001"
