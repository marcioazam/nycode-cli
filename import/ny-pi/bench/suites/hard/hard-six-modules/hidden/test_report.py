import json

import pytest
from relkit.cli import main
from relkit.errors import ConfigError, ParseError, ReportError
from relkit.report.build import build_report
from relkit.report.model import FileEntry

MANIFEST = """\
[release]
name = "relkit"
version = 1.4.0
channel = stable
compat = ^1.0.0

[artifacts]
include = dist/*.{whl,tar.gz}, !dist/*-debug.*
max_name = 20

[cost]
rate_per_hour = USD 12.00
shares = 3:1

[budget]
max_cost = USD 1.00
"""
ENTRADAS = [
    FileEntry("dist/relkit-1.4.0.whl", 120000, "1m30s"),
    FileEntry("dist/relkit-1.4.0.tar.gz", 95000, "45s"),
    FileEntry("dist/relkit-1.4.0-debug.whl", 900000, "2m"),
    FileEntry("docs/guide.pdf", 5000, "10s"),
]
HISTORICO = ["1.3.2", "2.0.0", "1.3.10", "1.4.0-rc.1"]
ESPERADO = """\
Release relkit 1.4.0 (stable)
Next: patch 1.4.1, minor 1.5.0, major 2.0.0
Compatible: 1.3.10

File                 |    Size |  Build |     Cost
---------------------+---------+--------+---------
dist/relkit-1.4.0.w… | 120,000 | 1m 30s | USD 0.30
dist/relkit-1.4.0.t… |  95,000 |    45s | USD 0.15

Total: 2 files, 215,000 bytes, 2m 15s, USD 0.45
Within budget: USD 0.55 left
Shares: USD 0.34 / USD 0.11"""

MINIMO = "[release]\nname = x\nversion = 0.1.0\n[artifacts]\ninclude = *\n[cost]\nrate_per_hour = {rate}\n"


def _troca(texto, antigo, novo):
    assert antigo in texto
    return texto.replace(antigo, novo)


def test_exemplo_do_spec_byte_a_byte():
    assert build_report(MANIFEST, ENTRADAS, HISTORICO) == ESPERADO


def test_selecao_ordem_e_normalizacao():
    manifesto = _troca(MINIMO.format(rate="USD 60.00"), "include = *", "include = **")
    entradas = [
        FileEntry("./b\\y.txt", 10, "1s"),
        FileEntry("a.txt", 10, "1m"),
        FileEntry("c//z.txt", 99, "500ms"),
        FileEntry(".oculto", 1000, "1s"),
    ]
    linhas = build_report(manifesto, entradas).split("\n")
    assert [l.split(" | ")[0].strip() for l in linhas[6:9]] == [
        "c/z.txt",
        "a.txt",
        "b/y.txt",
    ]
    assert linhas[0] == "Release x 0.1.0" and linhas[2] == "Compatible: none"
    assert linhas[
        -1
    ] in (  # B5 não fixa: soma dos custos por arquivo, ou taxa × duração total
        "Total: 3 files, 119 bytes, 1m 1s 500ms, USD 1.03",
        "Total: 3 files, 119 bytes, 1m 1s 500ms, USD 1.02",
    )
    assert [l.rsplit(" | ", 1)[1] for l in linhas[6:9]] == [
        "USD 0.01",
        "USD 1.00",
        "USD 0.02",
    ]


def test_custo_arredonda_para_par():
    # 1 centavo por hora; 1800000 ms = meia hora = 0.5 centavo -> 0; 5400000 ms = 1.5 -> 2
    manifesto = MINIMO.format(rate="USD 0.01")
    saida = build_report(
        manifesto,
        [
            FileEntry("a", 1, "30m"),
            FileEntry("b", 1, "1h30m"),
            FileEntry("c", 1, "2h30m"),
        ],
    )
    custos = [l.rsplit(" | ", 1)[1] for l in saida.split("\n")[6:9]]
    assert custos == ["USD 0.00", "USD 0.02", "USD 0.02"]
    assert saida.split("\n")[-1].startswith("Total: 3 files, 3 bytes, 4h 30m, USD 0.04")


def test_include_com_chaves_escape_e_max_name():
    manifesto = _troca(
        MINIMO.format(rate="USD 1.00"),
        "include = *",
        "include = {a,b}.{x,y}, c\\,d.z ,, ",
    )
    manifesto += "[x]\n"
    entradas = [
        FileEntry(n, 1, "1s") for n in ("a.x", "b.y", "c,d.z", "a.z", "c", "d.z")
    ]
    linhas = build_report(manifesto, entradas).split("\n")
    assert [l.split(" ")[0] for l in linhas[6:9]] == ["a.x", "b.y", "c,d.z"] and linhas[
        9
    ] == ""
    curto = _troca(manifesto, "[cost]", "max_name = 2\n[cost]")
    assert "a…" in build_report(curto, entradas) and "c…" in build_report(
        curto, entradas
    )


def test_orcamento_e_cotas():
    base = MANIFEST
    estourado = _troca(base, "max_cost = USD 1.00", "max_cost = USD 0.40")
    assert (
        build_report(estourado, ENTRADAS, HISTORICO).split("\n")[-2]
        == "OVER BUDGET by USD 0.05"
    )
    igual = _troca(base, "max_cost = USD 1.00", "max_cost = USD 0.45")
    assert (
        build_report(igual, ENTRADAS, HISTORICO).split("\n")[-2]
        == "Within budget: USD 0.00 left"
    )
    sem = _troca(_troca(base, "shares = 3:1\n", ""), "max_cost = USD 1.00", "")
    assert (
        build_report(sem, ENTRADAS, HISTORICO)
        .split("\n")[-1]
        .startswith("Total: 2 files")
    )
    so_cotas = _troca(
        _troca(base, "shares = 3:1", "shares = 1 : 1 : 1"), "max_cost = USD 1.00", ""
    )
    assert (
        build_report(so_cotas, ENTRADAS, HISTORICO).split("\n")[-1]
        == "Shares: USD 0.15 / USD 0.15 / USD 0.15"
    )


def test_historico_e_canal_opcionais():
    sem_canal = _troca(
        _troca(MANIFEST, "channel = stable\n", ""), "compat = ^1.0.0\n", ""
    )
    saida = build_report(sem_canal, ENTRADAS, ["1.0.0", "2.0.0-rc.1", "1.9.0"]).split(
        "\n"
    )
    assert saida[0] == "Release relkit 1.4.0"
    assert (
        build_report(sem_canal, ENTRADAS, ["1.0.0", "2.0.0-rc.1", "1.9.0"]).split("\n")[
            2
        ]
        == "Compatible: 1.9.0"
    )
    assert build_report(MANIFEST, ENTRADAS).split("\n")[2] == "Compatible: none"
    pre = _troca(MANIFEST, "compat = ^1.0.0", "compat = >=1.4.0-a")
    assert (
        build_report(pre, ENTRADAS, ("1.3.0", "1.4.0-rc.1")).split("\n")[2]
        == "Compatible: 1.4.0-rc.1"
    )


CASOS_ERRO = [
    (
        ("include = dist/*.{whl,tar.gz}, !dist/*-debug.*", "include = ,  ,"),
        ReportError,
        "no include patterns",
    ),
    (
        ("include = dist/*.{whl,tar.gz}, !dist/*-debug.*", "include = nada/**"),
        ReportError,
        "no files match",
    ),
    (("max_name = 20", "max_name = 1"), ReportError, "bad max_name"),
    (("max_name = 20", "max_name = x"), ReportError, "bad max_name"),
    (
        ("max_cost = USD 1.00", "max_cost = EUR 1.00"),
        ReportError,
        "budget currency mismatch",
    ),
    (("shares = 3:1", "shares = 3:x"), ReportError, "bad shares"),
    (("shares = 3:1", "shares = 0:0"), ReportError, "bad shares"),
    (
        ("version = 1.4.0", "version = 1.4"),
        ParseError,
        "invalid version '1.4': expected MAJOR.MINOR.PATCH",
    ),
    (("compat = ^1.0.0", "compat = ^1"), ParseError, "invalid spec '^1'"),
    (
        ("include = dist/*.{whl,tar.gz}", "include = dist/*.{whl"),
        ParseError,
        "invalid pattern",
    ),
    (("rate_per_hour = USD 12.00", "rate_per_hour = 12"), ParseError, "invalid money"),
    (
        ("[cost]\nrate_per_hour = USD 12.00\n", ""),
        ConfigError,
        "line 0: missing 'cost.rate_per_hour'",
    ),
    (('name = "relkit"\n', ""), ConfigError, "line 0: missing 'release.name'"),
    (("[budget]", "[release]"), ConfigError, "line 15: duplicate section 'release'"),
]


def test_erros_do_relatorio():
    for troca, erro, texto in CASOS_ERRO:
        with pytest.raises(erro) as info:
            build_report(_troca(MANIFEST, *troca), ENTRADAS, HISTORICO)
        assert texto in str(info.value), texto


def test_erros_de_dados_de_entrada():
    with pytest.raises(ParseError, match="invalid duration '1x'"):
        build_report(MANIFEST, [FileEntry("dist/a.whl", 1, "1x")], [])
    with pytest.raises(ParseError, match="invalid version 'oops'"):
        build_report(MANIFEST, ENTRADAS, ["1.0.0", "oops"])
    with pytest.raises(ConfigError, match="unknown reference"):
        build_report(MANIFEST + "[z]\nk = ${nada.x}\n", ENTRADAS, [])


def test_cli_ponta_a_ponta(tmp_path, capsys):
    manifesto, arquivos = tmp_path / "m.ini", tmp_path / "f.json"
    manifesto.write_text(MANIFEST, encoding="utf-8")
    arquivos.write_text(
        json.dumps(
            [{"path": e.path, "size": e.size, "build": e.build} for e in ENTRADAS]
        ),
        encoding="utf-8",
    )
    assert (
        main(
            ["report", str(manifesto), str(arquivos), "--history", ",".join(HISTORICO)]
        )
        == 0
    )
    assert capsys.readouterr().out == ESPERADO + "\n"
    manifesto.write_text(MANIFEST.replace("USD 12.00", "12"), encoding="utf-8")
    assert main(["report", str(manifesto), str(arquivos)]) == 2
    assert (
        capsys.readouterr().err
        == "error: invalid money '12': expected 'CODE amount' or 'amount CODE'\n"
    )
