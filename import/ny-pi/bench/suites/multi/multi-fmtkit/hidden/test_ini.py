import pytest
from ini import parse


def test_basic():
    text = "# c\n[a]\nx = 1\ny=two = 2\n\n; c\n[b]\nz =\n"
    assert parse(text) == {"a": {"x": "1", "y": "two = 2"}, "b": {"z": ""}}


def test_last_wins_and_reopen():
    assert parse("[a]\nx=1\nx=2\n[a]\ny=3") == {"a": {"x": "2", "y": "3"}}


def test_empty():
    assert parse("") == {}
    assert parse("[only]") == {"only": {}}


@pytest.mark.parametrize(
    "text,line",
    [
        ("x=1\n[a]", "line 1"),
        ("[a]\nnoequals", "line 2"),
        ("[a\nx=1", "line 1"),
        ("\n\n[a]\n=v", "line 4"),
        ("[]\n", "line 1"),
    ],
)
def test_errors(text, line):
    with pytest.raises(ValueError, match=line):
        parse(text)
