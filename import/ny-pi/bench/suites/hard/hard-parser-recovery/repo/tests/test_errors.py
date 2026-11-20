import pytest
from cfgparse import parse
from cfgparse.api import load
from cfgparse.parser.diagnostics import ParseError


def pos(text):
    return [(d.line, d.col, d.code) for d in parse(text).diagnostics]


def test_bad_char_and_syntax():
    assert pos("a = 1\nb = @\nc 3\n") == [(2, 5, "E_CHAR"), (3, 3, "E_SYNTAX")]


def test_unterminated_string_and_escape():
    assert pos('a = "abc\nb = "x\\q"\n') == [(1, 5, "E_STRING"), (2, 7, "E_STRING")]


def test_unterminated_list_points_to_open_bracket():
    assert pos("a = 1\nb = [1,\n  2,\n") == [(2, 5, "E_LIST")]


def test_error_inside_indented_multiline_list():
    assert pos("xs = [\n  1,\n  oops,\n  3\n]\nb = 2\n") == [(3, 3, "E_SYNTAX")]


def test_duplicates():
    text = "a = 1\na = 2\n[s]\n[s]\n"
    assert pos(text) == [(2, 1, "E_DUP_KEY"), (4, 1, "E_DUP_SECTION")]
    assert parse(text).config["a"] == 1


def test_header_errors_without_body():
    assert pos("[bad name]\n[ok]\nk = 1\n") == [(1, 6, "E_HEADER")]
    assert parse("[bad name]\n[ok]\nk = 1\n").config == {"ok": {"k": 1}}


def test_invalid_header_body_is_checked_but_discarded():
    text = "[s]\na = 1\n[s]\na = 2\nb = $\n[t]\nc = 3\n"
    assert pos(text) == [(3, 1, "E_DUP_SECTION"), (5, 5, "E_CHAR")]
    assert parse(text).config == {"s": {"a": 1}, "t": {"c": 3}}


def test_recovery_continues_after_bad_lines():
    text = 'a = "abc\nb = 2\nc = 1 2\nd = [1, 2]\n'
    assert pos(text) == [(1, 5, "E_STRING"), (3, 7, "E_SYNTAX")]
    assert parse(text).config == {"b": 2, "d": [1, 2]}


def test_conflict():
    assert pos("a = 1\n[a]\n[b]\n") == [(2, 1, "E_CONFLICT")]


def test_strict_raises_first():
    with pytest.raises(ParseError) as exc:
        load("a = @\nb = $\n")
    assert exc.value.diagnostic.line == 1


def test_diagnostics_sorted():
    assert [d.line for d in parse("a = @\nb = $\nc = %\n").diagnostics] == [1, 2, 3]
