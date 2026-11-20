from pathlib import Path

from reportkit.cli import main

SAMPLE = str(Path(__file__).resolve().parent.parent / "data" / "orders.csv")
HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct\n"


def test_stdout_and_formats(capsys):
    assert main([SAMPLE]) == 0
    out, err = capsys.readouterr()
    assert (
        out.startswith("SALES REPORT\nPeriod: 2024-01-03 to 2024-04-01\n") and err == ""
    )
    assert main([SAMPLE, "--format", "csv"]) == 0
    assert capsys.readouterr().out.startswith(
        "region,product,orders,units,gross,discount,net,share\r\n"
    )


def test_output_file(tmp_path, capsys):
    target = tmp_path / "out.csv"
    assert main([SAMPLE, "-f", "csv", "-o", str(target)]) == 0
    assert capsys.readouterr().out == ""
    assert target.read_bytes().endswith(b"TOTAL,,6,27,848.25,63.66,784.59,\r\n")


def test_errors_go_to_stderr(tmp_path, capsys):
    source = tmp_path / "bad.csv"
    source.write_text(
        HEADER + "A1,2024-01-03,NORTH,W,0,1,\nA2,x,NORTH,W,1,1,\n", encoding="utf-8"
    )
    assert main([str(source)]) == 2
    out, err = capsys.readouterr()
    assert out == ""
    assert (
        err
        == "error: line 2: quantity: invalid quantity '0'\nline 3: date: invalid date 'x'\n"
    )
    assert main([SAMPLE, "-f", "xml"]) == 2
    assert capsys.readouterr().err == "error: unknown format 'xml'\n"
