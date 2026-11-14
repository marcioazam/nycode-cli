import pytest
from ipv4 import in_cidr, parse_ipv4


def test_parse():
    assert parse_ipv4("0.0.0.0") == 0
    assert parse_ipv4("192.168.1.10") == 0xC0A8010A
    assert parse_ipv4("255.255.255.255") == 2**32 - 1


@pytest.mark.parametrize(
    "bad",
    [
        "1.2.3",
        "1.2.3.4.5",
        "256.1.1.1",
        "01.2.3.4",
        "1.2.3.-4",
        "a.b.c.d",
        " 1.2.3.4",
        "1..3.4",
        "",
    ],
)
def test_parse_bad(bad):
    with pytest.raises(ValueError):
        parse_ipv4(bad)


def test_cidr():
    assert in_cidr("10.1.2.3", "10.0.0.0/8")
    assert not in_cidr("11.1.2.3", "10.0.0.0/8")
    assert in_cidr("192.168.1.77", "192.168.1.64/26")
    assert not in_cidr("192.168.1.128", "192.168.1.64/26")
    assert in_cidr("1.2.3.4", "0.0.0.0/0")
    assert in_cidr("1.2.3.4", "1.2.3.4/32")
    assert not in_cidr("1.2.3.5", "1.2.3.4/32")
    assert in_cidr("10.0.0.9", "10.0.0.1/24")


@pytest.mark.parametrize(
    "ip,cidr",
    [
        ("1.2.3.4", "1.2.3.0"),
        ("1.2.3.4", "1.2.3.0/33"),
        ("1.2.3.4", "1.2.3.0/x"),
        ("1.2.3", "1.2.3.0/24"),
        ("1.2.3.4", "1.2.3/24"),
        ("1.2.3.4", "1.2.3.0/-1"),
    ],
)
def test_cidr_bad(ip, cidr):
    with pytest.raises(ValueError):
        in_cidr(ip, cidr)
