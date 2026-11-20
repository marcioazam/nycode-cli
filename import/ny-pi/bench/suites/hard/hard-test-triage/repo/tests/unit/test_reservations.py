import pytest
from stockroom.errors import InsufficientStock, ValidationError
from stockroom.inventory.ledger import Ledger
from stockroom.inventory.reservations import Reservations


def make(qty=10):
    ledger = Ledger()
    ledger.receive("AB-100", qty)
    return ledger, Reservations(ledger)


def test_reserve_reduces_available_only():
    ledger, res = make()
    res.reserve("ORD-T1", "AB-100", 3)
    res.reserve("ORD-T2", "AB-100", 2)
    res.reserve("ORD-T1", "AB-100", 1)
    assert (res.reserved("AB-100"), res.available("AB-100")) == (6, 4)
    assert ledger.on_hand("AB-100") == 10
    assert res.reserved_for("ORD-T1") == {"AB-100": 4}


def test_reserve_everything_available():
    _, res = make()
    res.reserve("ORD-T1", "AB-100", 4)
    res.reserve("ORD-T2", "AB-100", 6)
    assert res.available("AB-100") == 0
    with pytest.raises(InsufficientStock):
        res.reserve("ORD-T3", "AB-100", 1)


def test_reserve_more_than_available_changes_nothing():
    _, res = make()
    res.reserve("ORD-T1", "AB-100", 7)
    with pytest.raises(InsufficientStock):
        res.reserve("ORD-T2", "AB-100", 4)
    assert res.reserved_for("ORD-T2") == {}
    assert res.available("AB-100") == 3


def test_release_returns_units():
    _, res = make()
    res.reserve("ORD-T1", "AB-100", 3)
    res.reserve("ORD-T2", "AB-100", 2)
    assert res.release("ORD-T1") == 3
    assert res.release("ORD-T1") == 0
    assert res.release("ORD-T9") == 0
    assert res.available("AB-100") == 8


def test_reserve_invalid_quantity():
    _, res = make()
    with pytest.raises(ValidationError):
        res.reserve("ORD-T1", "AB-100", 0)
