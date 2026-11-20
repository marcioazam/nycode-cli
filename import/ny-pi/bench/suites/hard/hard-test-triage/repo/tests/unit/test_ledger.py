import pytest
from stockroom.errors import InsufficientStock, ValidationError
from stockroom.inventory.ledger import Ledger


def test_receive_and_issue():
    ledger = Ledger()
    ledger.receive("AB-100", 10)
    ledger.issue("AB-100", 4)
    ledger.issue("AB-100", 6)
    assert ledger.on_hand("AB-100") == 0
    assert ledger.on_hand("CD-200") == 0
    assert ledger.skus() == ["AB-100"]


def test_issue_more_than_on_hand_changes_nothing():
    ledger = Ledger()
    ledger.receive("AB-100", 3)
    with pytest.raises(InsufficientStock):
        ledger.issue("AB-100", 4)
    assert ledger.on_hand("AB-100") == 3
    assert ledger.history("AB-100") == [("receive", 3)]


@pytest.mark.parametrize("qty", [0, -1, 1.5, True])
def test_invalid_quantity(qty):
    ledger = Ledger()
    with pytest.raises(ValidationError):
        ledger.receive("AB-100", qty)
    with pytest.raises(ValidationError):
        ledger.issue("AB-100", qty)


def test_history_keeps_order():
    ledger = Ledger()
    ledger.receive("AB-100", 5)
    ledger.receive("CD-200", 1)
    ledger.issue("AB-100", 2)
    assert ledger.history("AB-100") == [("receive", 5), ("issue", 2)]
