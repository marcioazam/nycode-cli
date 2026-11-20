from docflow.cli.formatting import format_info, format_row
from docflow.cli.main import main, run_cli


def test_list_rows():
    code, text = run_cli(["list"])
    assert code == 0
    lines = text.splitlines()
    assert "strip\t10\ttransform" in lines
    assert "audit\t200\tobserver" in lines
    assert lines.index("strip\t10\ttransform") < lines.index("audit\t200\tobserver")


def test_info():
    code, text = run_cli(["info", "audit"])
    assert code == 0
    assert text == "name: audit\nkind: observer\npriority: 200\nrequires: wordcount"
    code, text = run_cli(["info", "lower"])
    assert text.splitlines()[-1] == "requires: -"


def test_run():
    assert run_cli(["run", "strip|upper", "  hi "]) == (0, "HI")


def test_errors():
    code, text = run_cli(["info", "vis-none"])
    assert code == 1 and text.startswith("error: ")
    code, text = run_cli(["run", "vis-none", "x"])
    assert code == 1
    assert run_cli(["bogus"]) == (2, "unknown command: bogus")
    assert run_cli([])[0] == 2
    assert run_cli(["info"])[0] == 2


def test_main_prints(capsys):
    assert main(["run", "lower", "ABC"]) == 0
    assert capsys.readouterr().out == "abc\n"


def test_formatting_helpers():
    assert format_row("a", 5, "transform") == "a\t5\ttransform"
    info = {"name": "a", "kind": "observer", "priority": 1, "requires": ["b", "c"]}
    assert format_info(info).splitlines()[-1] == "requires: b, c"
