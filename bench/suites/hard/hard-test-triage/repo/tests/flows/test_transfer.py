import pytest
from stockroom.errors import InsufficientStock, ValidationError
from stockroom.inventory.transfer import transfer
from stockroom.inventory.warehouse import Warehouse


def make_pair():
    source, target = Warehouse("central"), Warehouse("filial")
    source.receive("AB-100", 5, "2031-03-01")
    source.receive("AB-100", 5, "2031-01-15")
    return source, target


def test_transfer_moves_stock_and_keeps_expiry():
    source, target = make_pair()
    picks = transfer(source, target, "AB-100", 7)
    assert [(p.qty, p.expiry) for p in picks] == [(5, "2031-01-15"), (2, "2031-03-01")]
    assert (source.on_hand("AB-100"), target.on_hand("AB-100")) == (3, 7)
    assert [(lot.qty, lot.expiry) for lot in target.lots.open_lots("AB-100")] == [
        (5, "2031-01-15"),
        (2, "2031-03-01"),
    ]


def test_transfer_to_same_warehouse():
    source, _ = make_pair()
    with pytest.raises(ValidationError):
        transfer(source, source, "AB-100", 1)


def test_transfer_respects_reservations():
    source, target = make_pair()
    source.reservations.reserve("ORD-T1", "AB-100", 6)
    with pytest.raises(InsufficientStock):
        transfer(source, target, "AB-100", 5)
    assert (source.on_hand("AB-100"), target.on_hand("AB-100")) == (10, 0)
    assert source.lots.total("AB-100") == 10
    transfer(source, target, "AB-100", 4)
    assert (source.available("AB-100"), target.available("AB-100")) == (0, 4)


def test_transfer_invalid_quantity():
    source, target = make_pair()
    with pytest.raises(ValidationError):
        transfer(source, target, "AB-100", 0)
