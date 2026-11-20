from decimal import Decimal

import pytest
from pricing.discounts import FixedOff, PercentOff, SpendThreshold, total_discount
from pricing.errors import InvalidAmountError, UnknownRegionError
from pricing.shipping import shipping_cost
from pricing.tax import compute_tax


def test_percent_rounds_half_up():
    assert PercentOff(15).amount(Decimal("0.50")) == Decimal("0.08")
    with pytest.raises(InvalidAmountError):
        PercentOff(0)
    with pytest.raises(InvalidAmountError):
        PercentOff(101)


def test_fixed_and_threshold():
    assert FixedOff("5.00").amount(Decimal("80.00")) == Decimal("5.00")
    assert SpendThreshold("50.00", "5.00").amount(Decimal("49.99")) == Decimal("0.00")
    assert SpendThreshold("50.00", "5.00").amount(Decimal("50.00")) == Decimal("5.00")
    with pytest.raises(InvalidAmountError):
        FixedOff("0")
    with pytest.raises(InvalidAmountError):
        FixedOff("1.005")


def test_discounts_chain_and_cap():
    subtotal = Decimal("100.00")
    # 10% of 100 = 10; the threshold then sees 90 and does not apply.
    chained = total_discount(
        subtotal, [PercentOff(10), SpendThreshold("95.00", "5.00")]
    )
    assert chained == Decimal("10.00")
    assert total_discount(Decimal("3.00"), [FixedOff("5.00")]) == Decimal("3.00")
    assert total_discount(subtotal, []) == Decimal("0.00")


def test_tax_rounding_exemption_and_region():
    assert compute_tax(Decimal("10.00"), "US-CA") == Decimal("0.73")
    assert compute_tax(Decimal("10.00"), "US-CA", "nonprofit") == Decimal("0.00")
    with pytest.raises(UnknownRegionError):
        compute_tax(Decimal("10.00"), "ATLANTIS", "nonprofit")


def test_shipping():
    assert shipping_cost(Decimal("99.99")) == Decimal("7.50")
    assert shipping_cost(Decimal("100.00")) == Decimal("0.00")
    assert shipping_cost(Decimal("0.00")) == Decimal("0.00")
