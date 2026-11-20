import pytest
from ingest import cli, loader, parser, validate
from ingest.errors import IngestError, ParseError, ValidationError

OK = {"name": "pen", "qty": 2, "price": 5}


def test_hierarchy():
    assert issubclass(IngestError, ValueError)
    assert issubclass(ParseError, IngestError) and issubclass(
        ValidationError, IngestError
    )
    assert not issubclass(ParseError, ValidationError)


def test_parse_line():
    assert parser.parse_line(" pen : 2:5 ") == OK
    for bad in ["", "a:1", "a:b:c:d", "a:x:2", "a:1:y", "a:1:2.5"]:
        with pytest.raises(ParseError, match="malformed"):
            parser.parse_line(bad)


def test_check():
    assert validate.check(OK) is OK
    for rec, msg in [
        ({"name": "", "qty": 1, "price": 1}, "name is empty"),
        ({"name": "a", "qty": 0, "price": 1}, "qty must be positive"),
        ({"name": "a", "qty": -1, "price": 1}, "qty must be positive"),
        ({"name": "a", "qty": 1, "price": -1}, "price must be non-negative"),
    ]:
        with pytest.raises(ValidationError) as ei:
            validate.check(rec)
        assert str(ei.value) == msg
    assert validate.check({"name": "a", "qty": 1, "price": 0})


LINES = ["pen:2:5", "", "bad", "ink:0:3", "cap:1:-1", "  ", ":1:1", "ok:1:1"]


def test_load_tolerant():
    records, errors = loader.load(LINES)
    assert [r["name"] for r in records] == ["pen", "ok"]
    assert errors == [
        "3: malformed",
        "4: qty must be positive",
        "5: price must be non-negative",
        "7: name is empty",
    ]
    assert loader.load([]) == ([], [])
    assert loader.load(["", " "]) == ([], [])


def test_load_strict():
    with pytest.raises(ParseError) as ei:
        loader.load(LINES, strict=True)
    assert str(ei.value) == "3: malformed"
    with pytest.raises(ValidationError) as ei:
        loader.load(["a:1:1", "b:0:1", "zz"], strict=True)
    assert str(ei.value) == "2: qty must be positive"
    assert loader.load(["a:1:1"], strict=True) == (
        [{"name": "a", "qty": 1, "price": 1}],
        [],
    )


def write(tmp_path, lines):
    p = tmp_path / "in.txt"
    p.write_text("\n".join(lines) + "\n")
    return str(p)


def test_cli_ok(tmp_path, capsys):
    assert cli.main([write(tmp_path, ["a:1:2", "b:3:4"])]) == 0
    cap = capsys.readouterr()
    assert cap.out == "a 1 2\nb 3 4\n" and cap.err == ""


def test_cli_errors_tolerant(tmp_path, capsys):
    assert cli.main([write(tmp_path, ["a:1:2", "bad", "b:0:1"])]) == 1
    cap = capsys.readouterr()
    assert cap.out == "a 1 2\n"
    assert cap.err.splitlines() == ["2: malformed", "3: qty must be positive"]


def test_cli_strict(tmp_path, capsys):
    assert cli.main(["--strict", write(tmp_path, ["a:1:2", "bad", "b:0:1"])]) == 2
    cap = capsys.readouterr()
    assert cap.out == "" and cap.err.splitlines() == ["2: malformed"]
    assert cli.main(["--strict", write(tmp_path, ["a:1:2"])]) == 0
    assert capsys.readouterr().out == "a 1 2\n"
