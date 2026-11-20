import pytest
from sizes import human_bytes, parse_bytes


def test_human():
    assert human_bytes(0) == "0 B"
    assert human_bytes(1023) == "1023 B"
    assert human_bytes(1024) == "1.0 KiB"
    assert human_bytes(1536) == "1.5 KiB"
    assert human_bytes(3 * 1024**2) == "3.0 MiB"
    assert human_bytes(1024**3) == "1.0 GiB"
    assert human_bytes(1024**4) == "1.0 TiB"
    assert human_bytes(2048 * 1024**4) == "2048.0 TiB"


def test_human_negative():
    with pytest.raises(ValueError):
        human_bytes(-1)


def test_parse():
    assert parse_bytes("1.5 KiB") == 1536
    assert parse_bytes("10") == 10
    assert parse_bytes("10 B") == 10
    assert parse_bytes("2kb") == 2000
    assert parse_bytes("2KIB") == 2048
    assert parse_bytes(" 1 GB ") == 10**9
    assert parse_bytes("1MiB") == 1048576
    assert parse_bytes("0.9 B") == 0
    assert parse_bytes("1.5 TB") == 1_500_000_000_000


@pytest.mark.parametrize(
    "s", ["", "KiB", "1 XB", "-1 B", "1,5 KB", "1..5", "1 K", "1 B B"]
)
def test_parse_bad(s):
    with pytest.raises(ValueError):
        parse_bytes(s)
