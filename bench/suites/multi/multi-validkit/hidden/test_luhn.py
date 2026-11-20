import pytest
from luhn import luhn_valid


@pytest.mark.parametrize(
    "s", ["4539 1488 0343 6467", "79927398713", "0000", "5-9", "18"]
)
def test_valid(s):
    assert luhn_valid(s) is True


@pytest.mark.parametrize(
    "s", ["4539 1488 0343 6468", "79927398710", "", "0", "1", "12a4", "٤٥", "abc"]
)
def test_invalid(s):
    assert luhn_valid(s) is False
