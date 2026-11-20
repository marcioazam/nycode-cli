from stockroom.catalog.products import Product
from stockroom.inventory.reorder import needs_reorder, suggested_quantity


def product(**extra):
    return Product("AB-100", "Parafuso", 250, **extra)


def test_needs_reorder_at_or_below_point():
    p = product(reorder_point=20)
    assert needs_reorder(p, 21) is False
    assert needs_reorder(p, 20) is True
    assert needs_reorder(p, 0) is True


def test_reorder_point_zero_disables_reorder():
    p = product()
    assert needs_reorder(p, 0) is False
    assert suggested_quantity(p, 0) == 0


def test_suggested_quantity_reaches_twice_the_point():
    assert suggested_quantity(product(reorder_point=20), 15) == 25
    assert suggested_quantity(product(reorder_point=20, pack_size=12), 15) == 36
    assert suggested_quantity(product(reorder_point=20), 30) == 0


def test_suggested_quantity_exact_pack_multiple():
    assert suggested_quantity(product(reorder_point=20, pack_size=10), 20) == 20
    assert suggested_quantity(product(reorder_point=6, pack_size=12), 0) == 12
