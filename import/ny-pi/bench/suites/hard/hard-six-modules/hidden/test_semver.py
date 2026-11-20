import pytest
from relkit.core.semver import (
    bump,
    compare_versions,
    format_version,
    max_satisfying,
    parse_version,
    satisfies,
)
from relkit.errors import ParseError
from relkit.types import Version


def test_parse_basico_e_formato():
    assert parse_version(" v1.2.3 ") == Version(1, 2, 3)
    assert parse_version("1.2.3-rc.1+b05.x") == Version(
        1, 2, 3, ("rc", 1), ("b05", "x")
    )
    assert parse_version("1.0.0-alpha-1").pre == ("alpha-1",)
    assert parse_version("1.0.0-0.3.7").pre == (0, 3, 7)
    for text in ("1.2.3", "1.2.3-rc.1", "1.2.3-rc.1+b5", "0.0.0+007"):
        assert format_version(parse_version(text)) == text


CASOS_ERRO = [
    ("1.2", "expected MAJOR.MINOR.PATCH"),
    ("1.2.3.4", "expected MAJOR.MINOR.PATCH"),
    ("01.2.3", "bad number"),
    ("1.x.3", "bad number"),
    ("1.2.-3", "bad number"),
    ("1.2.3-", "bad pre-release"),
    ("1.2.3-a..b", "bad pre-release"),
    ("1.2.3-01", "leading zero in pre-release"),
    ("1.2.3+", "bad build metadata"),
    ("1.2.3+a_b", "bad build metadata"),
    ("V1.2.3", "bad number"),
]


def test_parse_erros():
    for text, reason in CASOS_ERRO:
        with pytest.raises(ParseError) as info:
            parse_version(text)
        assert (info.value.kind, info.value.reason) == ("version", reason)
        assert str(info.value) == f"invalid version {text!r}: {reason}"


def test_ordem_de_precedencia():
    ordem = [
        "1.0.0-alpha",
        "1.0.0-alpha.1",
        "1.0.0-alpha.beta",
        "1.0.0-beta",
        "1.0.0-beta.2",
        "1.0.0-beta.11",
        "1.0.0-rc.1",
        "1.0.0",
        "1.0.1",
        "1.1.0",
        "2.0.0",
    ]
    for i, a in enumerate(ordem):
        for j, b in enumerate(ordem):
            assert compare_versions(a, b) == (i > j) - (i < j), (a, b)
    assert compare_versions("1.0.0+a", "1.0.0+b") == 0
    assert compare_versions(Version(1, 0, 0), "1.0.0") == 0
    assert compare_versions("1.10.0", "1.9.0") == 1


def test_bump():
    assert bump("1.2.3-rc.1+x", "patch") == Version(1, 2, 4)
    assert bump("1.2.3", "minor") == Version(1, 3, 0)
    assert bump(Version(1, 2, 3), "major") == Version(2, 0, 0)
    with pytest.raises(ValueError):
        bump("1.2.3", "pre")


def test_satisfies_operadores_e_faixas():
    casos = [
        ("1.2.3", "^1.2.0", True),
        ("2.0.0", "^1.2.0", False),
        ("1.1.9", "^1.2.0", False),
        ("0.2.9", "^0.2.3", True),
        ("0.3.0", "^0.2.3", False),
        ("0.0.3", "^0.0.3", True),
        ("0.0.4", "^0.0.3", False),
        ("1.2.9", "~1.2.3", True),
        ("1.3.0", "~1.2.3", False),
        ("1.2.2", "~1.2.3", False),
        ("1.5.0", ">=1.2.0, <1.6.0", True),
        ("1.6.0", ">=1.2.0 , <1.6.0", False),
        ("1.2.3", "1.2.3", True),
        ("1.2.3", "=1.2.3", True),
        ("1.2.4", "=1.2.3", False),
        ("1.2.3", ">1.2.3", False),
        ("1.2.3", "<=1.2.3", True),
        ("3.0.0", "^1.0.0 || ^3.0.0", True),
        ("2.0.0", "^1.0.0 || ^3.0.0", False),
        ("9.9.9", "*", True),
        ("1.0.0+meta", "=1.0.0", True),
    ]
    for version, spec, esperado in casos:
        assert satisfies(version, spec) is esperado, (version, spec)


def test_satisfies_prerelease_e_erros():
    assert satisfies("1.3.0-beta.1", "^1.2.0") is False
    assert satisfies("1.3.0-beta.1", "*") is False
    assert satisfies("1.3.0-beta.1", ">=1.3.0-alpha") is True
    assert satisfies("1.3.0-beta.1", ">=1.3.0-alpha, <2.0.0") is True
    assert satisfies("1.4.0-beta.1", ">=1.3.0-alpha") is False
    assert satisfies("1.3.0-beta.1", "^1.2.0 || >=1.3.0-beta.0") is True
    for spec in ("", "  ", "^1.2.0,", ">=1.x", "|| ^1.0.0", "~1.2"):
        with pytest.raises(ParseError) as info:
            satisfies("1.0.0", spec)
        assert info.value.kind == "spec" and info.value.text == spec


def test_max_satisfying():
    lista = ["1.3.2", "2.0.0", "1.3.10", "1.4.0-rc.1", "1.3.10+b"]
    assert max_satisfying(lista, "^1.0.0") == "1.3.10"
    assert max_satisfying([Version(1, 2, 0), Version(1, 1, 0)], "*") == Version(1, 2, 0)
    assert max_satisfying(["1.0.0+b", "1.0.0+a"], "=1.0.0") == "1.0.0+b"
    assert max_satisfying(["1.0.0", "3.0.0"], "^2.0.0") is None
    assert max_satisfying([], "*") is None
    with pytest.raises(ParseError):
        max_satisfying(["1.0.0", "oops"], "^2.0.0")
