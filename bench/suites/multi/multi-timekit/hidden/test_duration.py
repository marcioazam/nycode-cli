import pytest
from duration import parse_duration


@pytest.mark.parametrize(
    "src,out",
    [
        ("1h30m", 5400),
        ("90s", 90),
        ("1d2h", 93600),
        ("1D 2H 3M 4S", 93784),
        ("0s", 0),
        ("120m", 7200),
    ],
)
def test_ok(src, out):
    assert parse_duration(src) == out


@pytest.mark.parametrize("src", ["", "5", "1x", "m5", "1h1h", "h", "1.5h", "-1s"])
def test_bad(src):
    with pytest.raises(ValueError):
        parse_duration(src)
