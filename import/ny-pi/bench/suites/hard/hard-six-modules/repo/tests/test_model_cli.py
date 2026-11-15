import pytest
from relkit.cli import main
from relkit.errors import ConfigError, ParseError, RelkitError, ReportError
from relkit.report.model import FileEntry, load_entries
from relkit.types import Money


def test_errors():
    err = ParseError("version", "x", "bad number")
    assert str(err) == "invalid version 'x': bad number" and isinstance(err, ValueError)
    assert str(ConfigError(3, "oops")) == "line 3: oops"
    assert issubclass(ReportError, RelkitError)


def test_money_type():
    assert Money(150, "USD").decimals == 2 and Money(5, "JPY").decimals == 0
    with pytest.raises(TypeError):
        Money(1.5, "USD")
    with pytest.raises(ValueError):
        Money(1, "XXX")


def test_load_entries():
    entries = load_entries('[{"path": "a", "size": 3, "build": "1s"}]')
    assert entries == [FileEntry("a", 3, "1s")]
    for bad in (
        "{",
        "{}",
        '[{"path": "a"}]',
        '[{"path": "a", "size": -1, "build": "1s"}]',
    ):
        with pytest.raises(ReportError):
            load_entries(bad)


def test_cli_rejeita_json_ruim(tmp_path, capsys):
    manifest = tmp_path / "m.ini"
    files = tmp_path / "f.json"
    manifest.write_text("[release]\n", encoding="utf-8")
    files.write_text("{", encoding="utf-8")
    assert main(["report", str(manifest), str(files)]) == 2
    assert "error: bad files json" in capsys.readouterr().err
