from decimal import Decimal as D

import pytest
from ledger.io.loader import load_records


def rec(**kw):
    base = {
        "id": "a",
        "kind": "sale",
        "amount": "10",
        "currency": "EUR",
        "date": "2024-01-02",
    }
    base.update(kw)
    return base


def test_load_and_order():
    j = load_records([rec(id="b", date="2024-01-03"), rec(id="a")])
    assert [e.id for e in j] == ["a", "b"]


def test_float_rejected():
    with pytest.raises(TypeError):
        load_records([rec(amount=1.5)])


def test_duplicate_id():
    with pytest.raises(ValueError):
        load_records([rec(), rec()])


def test_amount_decimal():
    assert next(iter(load_records([rec(amount="2.50")]))).amount == D("2.50")
