import pytest
from relkit.util.numbers import div_round_half_even, div_round_half_up, parse_uint
from relkit.util.ordering import stable_sort
from relkit.util.paths import normalize, segments
from relkit.util.scan import find_unquoted, split_unquoted
from relkit.util.text import display_width, pad, truncate


def test_parse_uint():
    assert parse_uint("0") == 0 and parse_uint("42") == 42
    assert (
        parse_uint("007") is None
        and parse_uint("") is None
        and parse_uint("-1") is None
    )


def test_rounding():
    assert [div_round_half_even(n, 2) for n in (1, 3, 5)] == [0, 2, 2]
    assert [div_round_half_up(n, 2) for n in (1, 3, -1, -3)] == [1, 2, -1, -2]
    with pytest.raises(ValueError):
        div_round_half_even(1, 0)


def test_stable_sort():
    items = [("b", 1), ("a", 1), ("c", 2)]
    assert stable_sort(items, [(lambda i: i[1], True)]) == [
        ("c", 2),
        ("b", 1),
        ("a", 1),
    ]
    assert stable_sort(items, [(lambda i: i[1], False), (lambda i: i[0], False)]) == [
        ("a", 1),
        ("b", 1),
        ("c", 2),
    ]


def test_paths():
    assert segments("a\\b//./c") == ["a", "b", "c"]
    assert normalize("/x/./y/") == "x/y"


def test_scan():
    assert find_unquoted('a"=b"=c', "=") == 5
    assert split_unquoted('a,"b,c",d', ",") == ["a", '"b,c"', "d"]
    assert find_unquoted("a=b", "=", 2) == -1


def test_text():
    assert display_width("日本") == 4 and display_width("e\u0301") == 1
    assert pad("ab", 5, "c") == " ab  " and pad("ab", 5, "r") == "   ab"
    assert truncate("abcdef", 4) == "abc…" and truncate("abc", 3) == "abc"
    with pytest.raises(ValueError):
        pad("a", 3, "x")
