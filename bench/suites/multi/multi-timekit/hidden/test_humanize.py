import pytest
from humanize import humanize


@pytest.mark.parametrize(
    "n,out",
    [
        (0, "0s"),
        (5, "5s"),
        (60, "1m"),
        (3600, "1h"),
        (5400, "1h 30m"),
        (93784, "1d 2h 3m 4s"),
        (86401, "1d 1s"),
        (200000, "2d 7h 33m 20s"),
    ],
)
def test_humanize(n, out):
    assert humanize(n) == out


def test_negative():
    with pytest.raises(ValueError):
        humanize(-1)
