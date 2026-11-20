import pytest
from stockroom.errors import InsufficientStock, ValidationError
from stockroom.inventory.lots import LotBook


def test_consume_earliest_expiry_first():
    book = LotBook()
    book.receive("AB-100", 5, "2031-06-01")
    book.receive("AB-100", 5, "2031-02-01")
    picks = book.consume("AB-100", 7)
    assert [(p.lot_id, p.qty) for p in picks] == [("L0002", 5), ("L0001", 2)]
    assert book.total("AB-100") == 3


def test_lots_without_expiry_are_consumed_last():
    book = LotBook()
    book.receive("AB-100", 4)
    book.receive("AB-100", 4, "2031-02-01")
    picks = book.consume("AB-100", 6)
    assert [(p.lot_id, p.qty, p.expiry) for p in picks] == [
        ("L0002", 4, "2031-02-01"),
        ("L0001", 2, None),
    ]


def test_same_expiry_follows_receipt_order():
    book = LotBook()
    book.receive("AB-100", 2, "2031-02-01")
    book.receive("CD-200", 9, "2031-01-01")
    book.receive("AB-100", 2, "2031-02-01")
    assert [p.lot_id for p in book.consume("AB-100", 3)] == ["L0001", "L0003"]
    assert book.total("CD-200") == 9


def test_consume_more_than_total_changes_nothing():
    book = LotBook()
    book.receive("AB-100", 2, "2031-02-01")
    with pytest.raises(InsufficientStock):
        book.consume("AB-100", 3)
    assert book.total("AB-100") == 2


def test_invalid_expiry():
    book = LotBook()
    for bad in ("2031-13-01", "01/02/2031", 20310201):
        with pytest.raises(ValidationError):
            book.receive("AB-100", 1, bad)
