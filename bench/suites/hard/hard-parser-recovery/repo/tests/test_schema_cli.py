from cfgparse import parse
from cfgparse.cli import main

SCHEMA = {"server.port": "int", "server.ratio": "float", "server.debug": "bool"}


def test_type_errors_at_key_position():
    text = '[server]\nport = "80"\nratio = 2\ndebug = 1\n'
    got = [(d.line, d.col, d.code) for d in parse(text, schema=SCHEMA).diagnostics]
    assert got == [(2, 1, "E_TYPE"), (4, 1, "E_TYPE")]


def test_cli_codes(tmp_path, capsys):
    good, bad = tmp_path / "g.cfg", tmp_path / "b.cfg"
    good.write_text("a = 1\n")
    bad.write_text("a = @\n")
    assert main([str(good)]) == 0
    assert main([str(bad)]) == 1
    assert capsys.readouterr().out.strip() == "1:5: E_CHAR: caractere inesperado '@'"
