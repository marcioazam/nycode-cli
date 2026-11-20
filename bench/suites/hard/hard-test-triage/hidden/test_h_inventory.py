import pytest
from stockroom.catalog.products import Catalog, Product
from stockroom.errors import InsufficientStock
from stockroom.inventory.ledger import Ledger
from stockroom.inventory.lots import LotBook
from stockroom.inventory.reorder import needs_reorder, suggested_quantity
from stockroom.inventory.reservations import Reservations
from stockroom.inventory.warehouse import Warehouse
from stockroom.reports.lowstock import low_stock


def test_reserve_whole_available_is_allowed():
    ledger = Ledger()
    ledger.receive("AB-100", 8)
    res = Reservations(ledger)
    res.reserve("ORD-H1", "AB-100", 8)
    assert res.available("AB-100") == 0
    with pytest.raises(InsufficientStock):
        res.reserve("ORD-H2", "AB-100", 1)
    assert res.release("ORD-H1") == 8
    res.reserve("ORD-H2", "AB-100", 3)
    res.reserve("ORD-H3", "AB-100", 5)
    with pytest.raises(InsufficientStock):
        res.reserve("ORD-H3", "AB-100", 1)
    assert res.reserved("AB-100") == 8


def test_undated_lots_go_last():
    book = LotBook()
    book.receive("AB-100", 3)
    book.receive("AB-100", 3, "2032-05-01")
    book.receive("AB-100", 3)
    book.receive("AB-100", 3, "2031-05-01")
    picks = book.consume("AB-100", 10)
    assert [(p.lot_id, p.qty) for p in picks] == [
        ("L0004", 3),
        ("L0002", 3),
        ("L0001", 3),
        ("L0003", 1),
    ]


def test_dated_lots_keep_fefo_and_receipt_order():
    book = LotBook()
    book.receive("AB-100", 2, "2031-05-01")
    book.receive("AB-100", 2, "2031-01-01")
    book.receive("AB-100", 2, "2031-05-01")
    assert [p.lot_id for p in book.consume("AB-100", 6)] == ["L0002", "L0001", "L0003"]
    with pytest.raises(InsufficientStock):
        book.consume("AB-100", 1)


def test_suggested_quantity_is_a_pack_multiple():
    p = Product("AB-100", "Parafuso", 250, reorder_point=20, pack_size=12)
    assert suggested_quantity(p, 15) == 36
    assert suggested_quantity(p, 16) == 24
    assert suggested_quantity(p, 20) == 24
    assert suggested_quantity(p, 21) == 0
    assert needs_reorder(p, 20) is True
    loose = Product("CD-200", "Arruela", 40, reorder_point=20)
    assert suggested_quantity(loose, 15) == 25


def test_low_stock_tie_breaks_by_sku_not_name():
    catalog = Catalog()
    catalog.add(Product("AB-100", "Zinco", 500, reorder_point=5))
    catalog.add(Product("CD-200", "Arame", 200, reorder_point=5))
    catalog.add(Product("EF-300", "Bucha", 100, reorder_point=9, pack_size=10))
    wh = Warehouse("central")
    for sku, qty in (("AB-100", 3), ("CD-200", 3), ("EF-300", 9)):
        wh.receive(sku, qty)
    rows = low_stock(catalog, wh)
    assert [(r.sku, r.available, r.suggested) for r in rows] == [
        ("AB-100", 3, 7),
        ("CD-200", 3, 7),
        ("EF-300", 9, 10),
    ]
