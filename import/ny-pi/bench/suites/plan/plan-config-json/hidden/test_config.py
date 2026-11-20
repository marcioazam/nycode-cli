import json

import pytest
from app import cli
from app.config import load
from app.server import describe


def write(tmp_path, name, text):
    p = tmp_path / name
    p.write_text(text)
    return str(p)


def test_ini_unchanged(tmp_path):
    p = write(tmp_path, "a.ini", "[server]\nhost = h\nport = 9000\ndebug = yes\n")
    assert load(p) == {"host": "h", "port": 9000, "debug": True}
    assert load(write(tmp_path, "b.ini", "")) == {
        "host": "localhost",
        "port": 8080,
        "debug": False,
    }


def test_json_full_and_defaults(tmp_path):
    p = write(
        tmp_path,
        "a.json",
        json.dumps({"server": {"host": "h", "port": 9000, "debug": True}}),
    )
    assert load(p) == {"host": "h", "port": 9000, "debug": True}
    assert load(write(tmp_path, "b.json", "{}")) == {
        "host": "localhost",
        "port": 8080,
        "debug": False,
    }
    assert load(write(tmp_path, "c.json", '{"server": {"port": 1}}'))["port"] == 1


def test_describe_json(tmp_path):
    p = write(tmp_path, "a.json", '{"server": {"host": "x", "port": 81}}')
    assert describe(p) == "x:81 (prod)"


@pytest.mark.parametrize("port", [0, 65536, -1])
def test_port_range_both_formats(tmp_path, port):
    with pytest.raises(ValueError):
        load(write(tmp_path, "a.json", json.dumps({"server": {"port": port}})))
    with pytest.raises(ValueError):
        load(write(tmp_path, "a.ini", f"[server]\nport = {port}\n"))


def test_port_bounds_ok(tmp_path):
    assert (
        load(write(tmp_path, "a.json", '{"server": {"port": 65535}}'))["port"] == 65535
    )
    assert load(write(tmp_path, "a.ini", "[server]\nport = 1\n"))["port"] == 1


@pytest.mark.parametrize(
    "text",
    [
        '{"server": {"port": "80"}}',
        '{"server": {"port": 80.5}}',
        '{"server": {"port": true}}',
        '{"server": {"debug": "yes"}}',
        "{not json",
        '{"server": {"host": 5}}',
        "[]",
    ],
)
def test_json_invalid(tmp_path, text):
    with pytest.raises(ValueError):
        load(write(tmp_path, "a.json", text))


def test_missing_file():
    with pytest.raises(FileNotFoundError):
        load("/nonexistent/x.json")
    with pytest.raises(FileNotFoundError):
        load("/nonexistent/x.ini")


def test_cli_codes(tmp_path, capsys):
    ok = write(tmp_path, "a.json", "{}")
    assert cli.main([ok]) == 0
    assert "localhost:8080" in capsys.readouterr().out
    assert cli.main(["/nonexistent/z.json"]) == 2
    assert cli.main([write(tmp_path, "bad.json", '{"server": {"port": 0}}')]) == 3
    assert cli.main([write(tmp_path, "bad.ini", "[server]\nport = abc\n")]) == 3
