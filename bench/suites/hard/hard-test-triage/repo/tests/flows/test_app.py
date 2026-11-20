import pytest
from stockroom import App
from stockroom.errors import DuplicateError, NotFoundError
from stockroom.orders.order import OrderLine


def make_app():
    app = App()
    app.add_product("AB-100", "Parafuso", 250, cost=100, weight_g=50, reorder_point=20)
    app.add_product("CD-200", "Arruela", 40, cost=10, pack_size=12, reorder_point=30)
    central = app.add_warehouse("central")
    central.receive("AB-100", 100)
    central.receive("CD-200", 24)
    return app


def test_create_order_normalizes_sku():
    app = make_app()
    order = app.create_order([(" ab-100 ", 2)])
    assert order.lines == (OrderLine("AB-100", 2),)
    assert order.status == "draft"
    assert app.order(order.id) is order


def test_create_order_unknown_sku():
    app = make_app()
    with pytest.raises(NotFoundError):
        app.create_order([("ZZ-999", 1)])
    with pytest.raises(NotFoundError):
        app.order("ORD-999999")


def test_confirm_and_ship_flow():
    app = make_app()
    central = app.warehouse("central")
    order = app.create_order([("AB-100", 30), ("CD-200", 6)])
    order.confirm(central)
    assert app.available("central", "ab-100") == 70
    assert central.on_hand("AB-100") == 100
    order.ship(central)
    assert central.on_hand("AB-100") == 70
    assert app.available("central", "CD-200") == 18


def test_totals_small_order():
    app = make_app()
    order = app.create_order([("AB-100", 8)])
    totals = app.totals(order.id)
    assert (totals.gross, totals.discount, totals.subtotal) == (2000, 0, 2000)
    assert totals.weight_g == 400
    assert totals.shipping == 1700
    assert totals.total == 3700


def test_low_stock_report_text():
    app = make_app()
    assert app.low_stock_report("central").splitlines() == [
        "sku     nome     disp  ponto  comprar",
        "------  -------  ----  -----  -------",
        "CD-200  Arruela    24     30       36",
    ]


def test_duplicate_warehouse():
    app = make_app()
    with pytest.raises(DuplicateError):
        app.add_warehouse("central")
    with pytest.raises(NotFoundError):
        app.warehouse("filial")
