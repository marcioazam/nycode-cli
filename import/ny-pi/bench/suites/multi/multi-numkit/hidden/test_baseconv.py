import pytest
from baseconv import from_base, to_base


def test_to_base():
    assert to_base(255, 16) == "ff"
    assert to_base(5, 2) == "101"
    assert to_base(0, 7) == "0"
    assert to_base(-255, 16) == "-ff"
    assert to_base(35, 36) == "z"
    assert to_base(36, 36) == "10"


def test_from_base():
    assert from_base("FF", 16) == 255
    assert from_base("ff", 16) == 255
    assert from_base("-101", 2) == -5
    assert from_base("0", 2) == 0
    assert from_base("Z", 36) == 35


def test_roundtrip():
    for base in (2, 3, 8, 10, 16, 36):
        for n in (-12345, -1, 0, 1, 99, 2**70):
            assert from_base(to_base(n, base), base) == n


@pytest.mark.parametrize(
    "s,b",
    [("", 10), ("-", 10), ("12", 2), ("g", 16), ("1 ", 10), ("+1", 10), ("1_0", 10)],
)
def test_from_bad(s, b):
    with pytest.raises(ValueError):
        from_base(s, b)


@pytest.mark.parametrize("b", [0, 1, 37, -2])
def test_bad_base(b):
    with pytest.raises(ValueError):
        to_base(5, b)
    with pytest.raises(ValueError):
        from_base("1", b)
