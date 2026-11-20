import pytest
from relkit.core.duration import format_duration, parse_duration
from relkit.core.table import render_table
from relkit.errors import ParseError


def test_parse_duration_validas():
    casos = {
        "1h30m": 5_400_000,
        "2d": 172_800_000,
        "1d 2h 3m 4s 5ms": 93_784_005,
        " 250ms ": 250,
        "1.5s": 1500,
        "0.0005s": 0,
        "0.0015s": 2,
        "0.0025s": 2,
        "1h0.5ms": 3_600_000,
        "0.5m": 30_000,
        "007s": 7000,
        "1.25h": 4_500_000,
        "0.1d": 8_640_000,
        "2.5ms": 2,
        "3.5ms": 4,
        "1m 1s": 61_000,
    }
    for texto, ms in casos.items():
        assert parse_duration(texto) == ms, texto


def test_parse_duration_erros():
    esperado = {
        "": "empty",
        "   ": "empty",
        "5x": "unknown unit",
        "5H": "unknown unit",
        "1hm": "unknown unit",
        "1m1h": "units out of order",
        "1s1s": "units out of order",
        "1s 1m": "units out of order",
        "1h30": "bad syntax",
        "1 h": "bad syntax",
        "h": "bad syntax",
        "1.s": "bad syntax",
        ".5s": "bad syntax",
        "-1s": "bad syntax",
        "1e3s": "unknown unit",
        "1h,30m": "bad syntax",
    }
    for texto, motivo in esperado.items():
        with pytest.raises(ParseError) as info:
            parse_duration(texto)
        assert (info.value.kind, info.value.reason) == ("duration", motivo), texto
        assert info.value.text == texto


def test_format_duration():
    assert format_duration(0) == "0ms"
    assert format_duration(90_061_001) == "1d 1h 1m 1s 1ms"
    assert (
        format_duration(60_000) == "1m"
        and format_duration(999) == "999ms"
        and format_duration(3_600_000) == "1h"
    )
    assert format_duration(200 * 86_400_000) == "200d"
    for ms in (0, 1, 61_001, 86_399_999, 123_456_789):
        assert parse_duration(format_duration(ms)) == ms
    for ruim in (-1, 1.5, "1", True, None):
        with pytest.raises(ValueError):
            format_duration(ruim)


def test_tabela_exemplo_e_alinhamentos():
    assert render_table(["Name", "Qty"], [["apple", 3], ["fig", 12]], "lr") == (
        "Name  | Qty\n------+----\napple |   3\nfig   |  12"
    )
    assert (
        render_table(["a", "bb"], [["xxxx", 1]], "cc")
        == " a   | bb\n-----+---\nxxxx | 1"
    )
    assert render_table(["a"], []) == "a\n-"
    assert (
        render_table(["a", "b"], [[None, "x"], ["", ""]]) == "a | b\n--+--\n  | x\n  |"
    )
    assert (
        render_table(["abcde", "f"], [["xy", 1]], "cr")
        == "abcde | f\n------+--\n xy   | 1"
    )


def test_tabela_largura_de_exibicao_e_cortes():
    saida = render_table(["Nome", "N"], [["日本語", 1], ["e\u0301a", 2]], "lr").split(
        "\n"
    )
    assert saida == ["Nome   | N", "-------+--", "日本語 | 1", "e\u0301a     | 2"]
    saida = render_table(
        ["Arquivo", "N"], [["abcdefghij", 1], ["日本語日本", 2]], "lr", [6, None]
    ).split("\n")
    assert saida == ["Arqui… | N", "-------+--", "abcde… | 1", "日本…  | 2"]
    saida = render_table(["abcdefgh", "x"], [["a", "b"]], "ll", [4, 1]).split("\n")
    assert saida == ["abc… | x", "-----+--", "a    | b"]
    assert (
        render_table(["a\nb", "c\td"], [["x\r\ny", "z"]]).split("\n")[0] == "a b  | c d"
    )
    assert render_table(["a\nb"], [["x\r\ny"]]) == "a b\n----\nx  y"
    _tabela_erros()


def _tabela_erros():
    with pytest.raises(ValueError, match=r"row 2 has 1 cells, expected 2"):
        render_table(["a", "b"], [["x", "y"], ["z"]])
    for kwargs in (
        {"aligns": "l"},
        {"aligns": "lx"},
        {"aligns": "lrc"},
        {"max_widths": [3]},
        {"max_widths": [3, 0]},
    ):
        with pytest.raises(ValueError):
            render_table(["a", "b"], [], **kwargs)
    with pytest.raises(ValueError):
        render_table([], [])
