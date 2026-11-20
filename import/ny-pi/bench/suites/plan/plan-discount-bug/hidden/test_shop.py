import pytest
from shop import checkout, report
from shop.cart import Cart


def cart(coupon=None, *items):
    c = Cart()
    for it in items or [("A", 12, 1000)]:
        c.add(*it)
    c.coupon = coupon
    return c


def test_no_coupon():
    c = cart()
    assert c.subtotal_cents() == 10800  # 12 * 1000 com 10% de volume
    assert checkout.total_cents(c) == 10800 + 1080


def test_pct_coupon_once():
    c = cart("PCT10")
    assert c.subtotal_cents() == 10800
    assert checkout.total_cents(c) == 9720 + 972


def test_fixed_coupon_once():
    c = cart("OFF500")
    assert c.subtotal_cents() == 10800
    assert checkout.total_cents(c) == 10300 + 1030


def test_fixed_coupon_floor_at_zero():
    c = cart("OFF500", ("B", 1, 300))
    assert c.subtotal_cents() == 300
    assert checkout.total_cents(c) == 0


def test_empty_cart():
    c = Cart()
    assert c.subtotal_cents() == 0
    assert checkout.total_cents(c) == 0
    c.coupon = "PCT10"
    assert checkout.total_cents(c) == 0


def test_unknown_coupon_still_keyerror():
    with pytest.raises(KeyError):
        checkout.total_cents(cart("NOPE"))


def test_small_quantities_no_volume_discount():
    c = cart("PCT10", ("A", 9, 1000), ("B", 1, 55))
    assert c.subtotal_cents() == 9055
    assert checkout.total_cents(c) == 8149 + 815  # 9055*90//100=8149; tax 814.9 -> 815


def test_receipt():
    assert report.receipt(cart("PCT10")) == ["Subtotal: 108.00", "Total: 106.92"]
    assert report.receipt(cart()) == ["Subtotal: 108.00", "Total: 118.80"]
