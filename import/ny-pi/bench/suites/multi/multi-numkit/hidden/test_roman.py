import pytest
from roman import from_roman, to_roman


def test_known():
    assert to_roman(1994) == "MCMXCIV"
    assert to_roman(4) == "IV"
    assert to_roman(3999) == "MMMCMXCIX"
    assert from_roman("MCMXCIV") == 1994
    assert from_roman("III") == 3


def test_roundtrip_all():
    for n in range(1, 4000):
        assert from_roman(to_roman(n)) == n


@pytest.mark.parametrize("n", [0, -1, 4000])
def test_to_bad(n):
    with pytest.raises(ValueError):
        to_roman(n)


@pytest.mark.parametrize("s", ["IIII", "VX", "IC", "", "mcm", "IIV", "MMMM", "XM", "A"])
def test_from_bad(s):
    with pytest.raises(ValueError):
        from_roman(s)
