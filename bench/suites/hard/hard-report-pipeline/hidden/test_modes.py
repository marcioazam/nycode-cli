"""R4 a R7: API, modo tolerante, linha Skipped rows e linha de comando."""

import json

import pytest
import reportkit
from reportkit.cli import main
from reportkit.errors import ExportError, ReadError, ValidationError
from reportkit.pipeline import run, run_with_warnings

HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct,status\n"
GOOD = "1,2024-01-03,NORTH,W,2,10.00,,\n2,2024-01-04,SOUTH,W,1,5.00,,refunded\n"
BAD = (
    "3,2024-01-05,NORTH,W,0,1.00,,\n"
    ",2024-02-30,MARS,W,1,1.00,,what\n"
    "4,2024-01-06,EAST,W,3,7.00,,\n"
    "3,2024-01-07,WEST,W,1,9.00,,\n"
)
MESSAGES = [
    "line 4: quantity: invalid quantity '0'",
    "line 5: order_id: empty",
    "line 5: date: invalid date '2024-02-30'",
    "line 5: region: unknown region 'MARS'",
    "line 5: status: unknown status 'what'",
    "line 7: order_id: duplicate of line 4",
]
CLEAN = HEADER + GOOD + "4,2024-01-06,EAST,W,3,7.00,,\n"
DIRTY = HEADER + GOOD + BAD


def test_r4_run_with_warnings_devolve_saida_e_avisos():
    for fmt in ("text", "csv", "json"):
        for report in ("summary", "monthly"):
            result = run_with_warnings(CLEAN, fmt, report)
            assert isinstance(result, tuple) and len(result) == 2
            assert result[0] == run(CLEAN, fmt, report)
            assert result[1] == []
    assert run_with_warnings(CLEAN) == (run(CLEAN), [])
    assert run(CLEAN, report="monthly", fmt="csv") == reportkit.run(
        CLEAN, "csv", "monthly"
    )
    assert run(CLEAN, "text", "summary", False) == run(CLEAN)


def test_r4_relatorio_e_formato_desconhecidos():
    for call in (run, run_with_warnings):
        with pytest.raises(ExportError) as info:
            call(CLEAN, "csv", "weekly")
        assert str(info.value) == "unknown report 'weekly'"
        with pytest.raises(ExportError) as info:
            call(CLEAN, "xml", "monthly")
        assert str(info.value) == "unknown format 'xml'"


def test_r4_conferidos_antes_de_ler_a_entrada():
    for text in ("", "order_id\n", DIRTY):
        with pytest.raises(ExportError) as info:
            run(text, "xml")
        assert str(info.value) == "unknown format 'xml'"
        with pytest.raises(ExportError) as info:
            run(text, "xml", "weekly", skip_invalid=True)
        assert str(info.value) == "unknown report 'weekly'"


def test_r5_modo_estrito_nao_muda():
    for report in ("summary", "monthly"):
        for call in (run, run_with_warnings):
            with pytest.raises(ValidationError) as info:
                call(DIRTY, "json", report)
            assert info.value.errors == MESSAGES


@pytest.mark.parametrize("report", ["summary", "monthly"])
def test_r5_modo_tolerante_descarta_e_avisa(report):
    for fmt in ("csv", "json"):
        output, warnings = run_with_warnings(DIRTY, fmt, report, skip_invalid=True)
        assert warnings == MESSAGES
        assert output == run(CLEAN, fmt, report)
        assert run(DIRTY, fmt, report, True) == output
    assert run_with_warnings(CLEAN, "csv", report, skip_invalid=True) == (
        run(CLEAN, "csv", report),
        [],
    )


def test_r5_todas_invalidas_gera_relatorio_vazio():
    output, warnings = run_with_warnings(
        HEADER + "1,x,NORTH,W,1,1.00,,\n", "json", "monthly", True
    )
    assert warnings == ["line 2: date: invalid date 'x'"]
    assert json.loads(output)["months"] == []


def test_r5_read_error_continua_fatal():
    with pytest.raises(ReadError) as info:
        run(
            HEADER + GOOD + "9,2024-01-01,NORTH\n", "text", "monthly", skip_invalid=True
        )
    assert str(info.value) == "line 4: expected 8 fields, got 3"
    with pytest.raises(ReadError):
        run_with_warnings("", skip_invalid=True)


@pytest.mark.parametrize("report", ["summary", "monthly"])
def test_r6_linha_skipped_rows_conta_linhas(report):
    clean = run(CLEAN, "text", report)
    assert run(DIRTY, "text", report, skip_invalid=True) == clean + "Skipped rows: 3\n"
    assert run(CLEAN, "text", report, skip_invalid=True) == clean
    assert "Skipped" not in run(DIRTY, "csv", report, skip_invalid=True)
    assert "kipped" not in run(DIRTY, "json", report, skip_invalid=True)


def write(tmp_path, text):
    path = tmp_path / "in.csv"
    path.write_bytes(text.encode("utf-8"))
    return str(path)


def test_r7_cli_report(tmp_path, capsys):
    source = write(tmp_path, CLEAN)
    for flag in ("-r", "--report"):
        assert main([source, flag, "monthly", "-f", "csv"]) == 0
        out, err = capsys.readouterr()
        assert out == run(CLEAN, "csv", "monthly") and err == ""
    assert main([source]) == 0
    assert capsys.readouterr().out == run(CLEAN)
    assert main([source, "-r", "summary", "-f", "json"]) == 0
    assert capsys.readouterr().out == run(CLEAN, "json")


def test_r7_cli_skip_invalid(tmp_path, capsys):
    source = write(tmp_path, DIRTY)
    assert main([source, "--skip-invalid", "--report", "monthly"]) == 0
    out, err = capsys.readouterr()
    assert out == run(CLEAN, "text", "monthly") + "Skipped rows: 3\n"
    assert err == "".join(f"warning: {message}\n" for message in MESSAGES)
    target = tmp_path / "out.txt"
    assert main([source, "--skip-invalid", "-o", str(target)]) == 0
    out, err = capsys.readouterr()
    assert out == "" and err.count("warning: ") == 6
    assert target.read_text(encoding="utf-8") == run(CLEAN) + "Skipped rows: 3\n"
    assert main([write(tmp_path, CLEAN), "--skip-invalid"]) == 0
    assert capsys.readouterr() == (run(CLEAN), "")


def test_r7_cli_erros(tmp_path, capsys):
    source = write(tmp_path, DIRTY)
    assert main([source, "-r", "monthly"]) == 2
    out, err = capsys.readouterr()
    assert out == "" and err == "error: " + "\n".join(MESSAGES) + "\n"
    assert main([source, "-r", "weekly", "-f", "xml", "--skip-invalid"]) == 2
    assert capsys.readouterr() == ("", "error: unknown report 'weekly'\n")
    assert main([source, "-f", "xml"]) == 2
    assert capsys.readouterr() == ("", "error: unknown format 'xml'\n")
