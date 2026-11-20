import pytest
from stockroom import App
from stockroom.errors import InsufficientStock, StateError, ValidationError
from stockroom.inventory.warehouse import Warehouse
from stockroom.orders.order import Order, OrderLine


def make_warehouse():
    wh = Warehouse("central")
    wh.receive("AB-100", 10)
    wh.receive("CD-200", 5)
    return wh


def test_first_order_id():
    app = App()
    app.add_product("AB-100", "Parafuso", 250)
    assert app.create_order([("AB-100", 1)]).id == "ORD-000001"
    assert app.create_order([("AB-100", 1)]).id == "ORD-000002"


def test_add_line_merges_same_sku():
    order = Order("ORD-T1")
    order.add_line("AB-100", 2)
    order.add_line("CD-200", 1)
    order.add_line("AB-100", 3)
    assert order.lines == (OrderLine("AB-100", 5), OrderLine("CD-200", 1))


def test_confirm_reserves_every_line():
    wh = make_warehouse()
    order = Order("ORD-T1")
    order.add_line("AB-100", 4)
    order.add_line("CD-200", 2)
    order.confirm(wh)
    assert order.status == "confirmed"
    assert (wh.available("AB-100"), wh.available("CD-200")) == (6, 3)
    assert wh.reservations.reserved_for("ORD-T1") == {"AB-100": 4, "CD-200": 2}


def test_confirm_is_all_or_nothing():
    wh = make_warehouse()
    order = Order("ORD-T1")
    order.add_line("AB-100", 4)
    order.add_line("CD-200", 6)
    with pytest.raises(InsufficientStock):
        order.confirm(wh)
    assert order.status == "draft"
    assert (wh.available("AB-100"), wh.available("CD-200")) == (10, 5)


def test_confirm_empty_order():
    with pytest.raises(ValidationError):
        Order("ORD-T1").confirm(make_warehouse())


def test_ship_consumes_stock_and_reservation():
    wh = make_warehouse()
    order = Order("ORD-T1")
    order.add_line("AB-100", 4)
    order.confirm(wh)
    picks = order.ship(wh)
    assert order.status == "shipped"
    assert [(p.lot_id, p.qty) for p in picks["AB-100"]] == [("L0001", 4)]
    assert (wh.on_hand("AB-100"), wh.available("AB-100")) == (6, 6)


def test_cancel_confirmed_releases_reservations():
    wh = make_warehouse()
    order = Order("ORD-T1")
    order.add_line("AB-100", 4)
    order.confirm(wh)
    assert wh.available("AB-100") == 6
    order.cancel(wh)
    assert order.status == "cancelled"
    assert wh.available("AB-100") == 10
    assert wh.on_hand("AB-100") == 10


def test_cancel_draft():
    wh = make_warehouse()
    order = Order("ORD-T1")
    order.add_line("AB-100", 4)
    order.cancel(wh)
    assert order.status == "cancelled"
    assert wh.available("AB-100") == 10


def test_final_states_reject_transitions():
    wh = make_warehouse()
    shipped = Order("ORD-T1")
    shipped.add_line("AB-100", 1)
    shipped.confirm(wh)
    shipped.ship(wh)
    with pytest.raises(StateError):
        shipped.cancel(wh)
    cancelled = Order("ORD-T2")
    cancelled.add_line("AB-100", 1)
    cancelled.cancel(wh)
    with pytest.raises(StateError):
        cancelled.confirm(wh)
    with pytest.raises(StateError):
        cancelled.cancel(wh)


def test_lines_are_frozen_after_confirm():
    wh = make_warehouse()
    order = Order("ORD-T1")
    order.add_line("AB-100", 1)
    order.confirm(wh)
    with pytest.raises(StateError):
        order.add_line("AB-100", 1)
    with pytest.raises(StateError):
        order.confirm(wh)
