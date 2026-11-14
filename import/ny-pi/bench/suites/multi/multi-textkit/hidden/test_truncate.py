import pytest
from truncate import truncate, wrap


def test_truncate():
    assert truncate("hello", 5) == "hello"
    assert truncate("hello world", 8) == "hello w…"
    assert truncate("hello world", 8, "...") == "hello..."
    assert truncate("abc", 1, "") == "a"
    assert truncate("", 1) == ""


def test_truncate_bad_width():
    with pytest.raises(ValueError):
        truncate("abc", 2, "...")


def test_wrap_basic():
    assert wrap("the quick brown fox", 9) == ["the quick", "brown fox"]
    assert wrap("", 5) == []
    assert wrap("   ", 5) == []


def test_wrap_long_words():
    assert wrap("abcdefgh ij", 5) == ["abcde", "fgh", "ij"]
    assert wrap("abcdefgh i", 5) == ["abcde", "fgh i"]


def test_wrap_bad_width():
    with pytest.raises(ValueError):
        wrap("x", 0)
