import pytest
from stockroom.catalog import Catalog, Product, normalize_sku
from stockroom.catalog.units import packs_needed, to_packs, to_units
from stockroom.errors import DuplicateError, NotFoundError, ValidationError


def test_normalize_sku():
    assert normalize_sku("  ab-100 ") == "AB-100"
    assert normalize_sku("wxyz-123456") == "WXYZ-123456"


@pytest.mark.parametrize(
    "raw", ["", "A-100", "ABCDE-100", "AB-12", "AB100", "AB-1x3", 7]
)
def test_invalid_sku(raw):
    with pytest.raises(ValidationError):
        normalize_sku(raw)


def test_catalog_add_get_and_order():
    catalog = Catalog()
    catalog.add(Product("cd-200", "Arruela", 40))
    catalog.add(Product("AB-100", "Parafuso", 250))
    assert catalog.get(" ab-100").name == "Parafuso"
    assert [p.sku for p in catalog.all()] == ["AB-100", "CD-200"]
    assert "cd-200" in catalog and "ZZ-999" not in catalog and "?" not in catalog
    assert len(catalog) == 2


def test_catalog_duplicate_and_unknown():
    catalog = Catalog()
    catalog.add(Product("AB-100", "Parafuso", 250))
    with pytest.raises(DuplicateError):
        catalog.add(Product(" ab-100", "Outro", 1))
    with pytest.raises(NotFoundError):
        catalog.get("ZZ-999")


def test_product_validation():
    for kwargs in ({"price": -1}, {"pack_size": 0}, {"weight_g": -5}, {"name": " "}):
        base = {"sku": "AB-100", "name": "Parafuso", "price": 250}
        with pytest.raises(ValidationError):
            Product(**{**base, **kwargs})


def test_units_and_packs():
    assert to_units(3, 12) == 36
    assert to_packs(25, 12) == (2, 1)
    assert (packs_needed(24, 12), packs_needed(25, 12), packs_needed(0, 12)) == (
        2,
        3,
        0,
    )
    with pytest.raises(ValidationError):
        to_packs(5, 0)
