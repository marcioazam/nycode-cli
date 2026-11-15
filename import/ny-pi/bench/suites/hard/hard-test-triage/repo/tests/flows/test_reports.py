from stockroom.catalog.products import Catalog, Product
from stockroom.inventory.warehouse import Warehouse
from stockroom.reports.lowstock import low_stock
from stockroom.reports.render import render_table
from stockroom.reports.valuation import valuation


def make_stock():
    catalog = Catalog()
    catalog.add(Product("AB-100", "Zinco", 500, cost=300, reorder_point=5))
    catalog.add(Product("CD-200", "Arame", 200, cost=120, reorder_point=5))
    catalog.add(Product("EF-300", "Bucha", 100, cost=40, reorder_point=8))
    catalog.add(Product("GH-400", "Cola", 900, cost=450))
    return catalog, Warehouse("central")


def test_low_stock_lists_only_items_at_or_below_point():
    catalog, wh = make_stock()
    wh.receive("AB-100", 6)
    wh.receive("CD-200", 5)
    wh.receive("EF-300", 3)
    rows = low_stock(catalog, wh)
    assert [(r.sku, r.available, r.suggested) for r in rows] == [
        ("EF-300", 3, 13),
        ("CD-200", 5, 5),
    ]


def test_low_stock_tie_is_ordered_by_sku():
    catalog, wh = make_stock()
    wh.receive("AB-100", 2)
    wh.receive("CD-200", 2)
    wh.receive("EF-300", 1)
    assert [r.sku for r in low_stock(catalog, wh)] == ["EF-300", "AB-100", "CD-200"]


def test_low_stock_uses_available_not_on_hand():
    catalog, wh = make_stock()
    wh.receive("AB-100", 9)
    assert low_stock(catalog, wh)[0].sku != "AB-100"
    wh.reservations.reserve("ORD-T1", "AB-100", 5)
    assert [(r.sku, r.available) for r in low_stock(catalog, wh)][-1] == ("AB-100", 4)


def test_valuation_rows_and_total():
    catalog, wh = make_stock()
    wh.receive("CD-200", 10)
    wh.receive("AB-100", 2)
    rows, total = valuation(catalog, wh)
    assert [(r.sku, r.on_hand, r.value) for r in rows] == [
        ("AB-100", 2, 600),
        ("CD-200", 10, 1200),
    ]
    assert total == 1800


def test_render_table_alignment():
    text = render_table(["sku", "qtd"], [("AB-100", 5), ("CD-200", 120)])
    assert text.splitlines() == [
        "sku     qtd",
        "------  ---",
        "AB-100    5",
        "CD-200  120",
    ]


def test_render_table_without_rows():
    assert render_table(["sku", "qtd"], []) == "sku  qtd\n---  ---"
