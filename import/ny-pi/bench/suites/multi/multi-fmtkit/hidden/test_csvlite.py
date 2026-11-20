import pytest
from csvlite import parse


def test_simple():
    assert parse("a,b,c\n1,2,3\n") == [["a", "b", "c"], ["1", "2", "3"]]
    assert parse("a,b") == [["a", "b"]]
    assert parse("") == []


def test_empty_fields():
    assert parse("a,,c\n,\n") == [["a", "", "c"], ["", ""]]
    assert parse('"",x') == [["", "x"]]


def test_quotes():
    assert parse('"a,b",c') == [["a,b", "c"]]
    assert parse('"he said ""hi""",x') == [['he said "hi"', "x"]]
    assert parse('"line1\nline2",z\n') == [["line1\nline2", "z"]]
    assert parse('""""') == [['"']]


def test_crlf_and_blank_lines():
    assert parse("a,b\r\n\r\n1,2\r\n") == [["a", "b"], ["1", "2"]]
    assert parse("\n\na\n\n") == [["a"]]


def test_unterminated():
    with pytest.raises(ValueError):
        parse('a,"b')
