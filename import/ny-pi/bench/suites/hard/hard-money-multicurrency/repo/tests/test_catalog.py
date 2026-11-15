from decimal import Decimal

import pytest
from pricing.catalog import Catalog, PriceList, Product
from pricing.errors import InvalidAmountError, UnknownProductError


def test_product_parses_price():
    assert Product("W", "Widget", "10.00").unit_price == Decimal("10.00")
    assert Product("W", "Widget", 3).unit_price == Decimal(3)


def test_product_rejects_float_negative_and_sub_cent():
    with pytest.raises(TypeError):
        Product("W", "Widget", 9.99)
    with pytest.raises(InvalidAmountError):
        Product("W", "Widget", "-1.00")
    with pytest.raises(InvalidAmountError):
        Product("W", "Widget", "1.234")


def test_catalog_lookup():
    catalog = Catalog()
    catalog.add(Product("B", "Bolt", "0.25", "hardware"))
    catalog.add(Product("A", "Apple", "1.00", "food"))
    assert catalog.skus() == ["A", "B"]
    assert catalog.get("B").name == "Bolt"
    assert [p.sku for p in catalog.by_category("food")] == ["A"]
    with pytest.raises(UnknownProductError):
        catalog.get("Z")


def test_pricelist_picks_highest_tier_reached():
    widget = Product("W", "Widget", "10.00")
    prices = PriceList()
    prices.set_tiers("W", [(10, "8.00"), (5, "9.00")])
    assert prices.unit_price(widget, 4) == Decimal("10.00")
    assert prices.unit_price(widget, 5) == Decimal("9.00")
    assert prices.unit_price(widget, 12) == Decimal("8.00")
