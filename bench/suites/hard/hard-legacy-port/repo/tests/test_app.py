import pytest
from app import arquivos, cli, config, lote, relatorio
from legacy import frete_calc


@pytest.fixture(autouse=True)
def _zera():
    frete_calc.zera()
    yield
    frete_calc.zera()


def test_parse_linha():
    pedido = lote.parse_linha("04567-000;E;frete10;1200,30,20,10,2,15000|500,0,0,0,1")
    assert pedido["cep"] == "04567-000"
    assert pedido["itens"] == [
        ("1200", "30", "20", "10", "2", "15000"),
        ("500", "0", "0", "0", "1"),
    ]
    with pytest.raises(ValueError):
        lote.parse_linha("so;tres;campos")


def test_linhas_uteis():
    assert arquivos.linhas_uteis("# c\n\n a;b \n") == ["a;b"]


def test_relatorio():
    texto = relatorio.relatorio(
        lote.parse_lote(["04567-000;N;;500,0,0,0,1", "x;N;;500,0,0,0,1"])
    )
    assert "COTACAO #0001" in texto
    assert "PEDIDO 2: ERRO 2 - CEP invalido" in texto
    assert texto.endswith("Cotacoes: 1  Erros: 1  Total: R$ 15,00\n")
    assert config.mensagem(99) == "erro 99"


def test_cli(tmp_path, capsys):
    arq = tmp_path / "lote.txt"
    arq.write_text("# lote\n20000-000;N;;700,0,0,0,2\n", encoding="utf-8")
    assert cli.main([str(arq)]) == 0
    assert "R$ 29,00" in capsys.readouterr().out
    assert cli.main([str(tmp_path / "nao-existe.txt")]) == 2
