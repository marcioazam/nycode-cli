import pytest
from legacy import frete_calc


@pytest.fixture(autouse=True)
def _zera():
    frete_calc.zera()
    yield
    frete_calc.zera()


def test_cotacao_simples():
    cod, res = frete_calc.calcula(
        {
            "cep": "04567-000",
            "serv": "E",
            "cupom": "frete10",
            "itens": [(1200, 30, 20, 10, 2, 15000)],
        }
    )
    assert cod == frete_calc.OK
    assert (res["zona"], res["peso"], res["frete"], res["total"], res["prazo"]) == (
        1,
        2400,
        2970,
        2970,
        1,
    )


def test_aceita_texto():
    cod, res = frete_calc.calcula(
        {"cep": "20000000", "itens": [("700", "0", "0", "0", "2")]}
    )
    assert cod == frete_calc.OK
    assert res["frete"] == 2900


def test_codigos_de_erro():
    assert (
        frete_calc.calcula({"cep": "04567-000", "itens": []})[0] == frete_calc.ERR_VAZIO
    )
    assert (
        frete_calc.calcula({"cep": "x", "itens": [(500, 0, 0, 0, 1)]})[0]
        == frete_calc.ERR_CEP
    )
    assert (
        frete_calc.calcula({"cep": "04567-000", "itens": [(0, 0, 0, 0, 1)]})[0]
        == frete_calc.ERR_ITEM
    )


def test_estado_global():
    frete_calc.calcula({"cep": "04567-000", "itens": [(500, 0, 0, 0, 1)]})
    frete_calc.calcula({"cep": "04567-000", "itens": [(500, 0, 0, 0, 1)]})
    assert frete_calc.CONTADOR == 2
    assert frete_calc.ACUMULADO == 3000
    assert frete_calc.ULTIMA["num"] == 2


def test_calcula_varios():
    bons, ruins = frete_calc.calcula_varios(
        [
            {"cep": "04567-000", "itens": [(500, 0, 0, 0, 1)]},
            {"cep": "", "itens": [(500, 0, 0, 0, 1)]},
        ]
    )
    assert len(bons) == 1
    assert ruins == [frete_calc.ERR_CEP]
