"""Validação, ordem das verificações, estado por instância, modelos e entradas/saídas de texto."""

import ast
import dataclasses
import subprocess
import sys
from pathlib import Path

import pytest
from frete import (
    Cotacao,
    Cotador,
    ErroCep,
    ErroFrete,
    ErroItem,
    ErroPedidoVazio,
    ErroPeso,
    ErroServico,
    Item,
    Pedido,
    etiqueta,
    formata_moeda,
    formata_peso,
    linha_csv,
)

RAIZ = Path(__file__).resolve().parent.parent


def _ped(itens, cep="20000000", servico="N", cupom=""):
    return Pedido(cep, itens, servico, cupom)


def test_excecoes_e_codigos():
    esperado = {
        ErroPedidoVazio: 1,
        ErroCep: 2,
        ErroItem: 3,
        ErroServico: 4,
        ErroPeso: 5,
    }
    for cls, codigo in esperado.items():
        assert issubclass(cls, ErroFrete) and issubclass(ErroFrete, Exception)
        assert cls.codigo == codigo


@pytest.mark.parametrize(
    "cep",
    ["", "1234567", "123456789", "abcdefgh", "00000000", "0000-0000", "01310-10x"],
)
def test_cep_invalido(cep):
    with pytest.raises(ErroCep):
        Cotador().cotar(_ped((Item(500, 0, 0, 0),), cep=cep))


@pytest.mark.parametrize("cep", ["04567-000", " 04567 000 ", "04.567-000", "04567000"])
def test_cep_normalizado(cep):
    c = Cotador().cotar(_ped((Item(500, 0, 0, 0),), cep=cep))
    assert c.cep_destino == "04567000"


def test_item_invalido():
    ruins = [
        Item(500, 0, 0, 0, -1),
        Item(0, 0, 0, 0),
        Item(-10, 0, 0, 0),
        Item(500, -1, 0, 0),
        Item(500, 0, -1, 0),
        Item(500, 0, 0, -1),
    ]
    for item in ruins:
        with pytest.raises(ErroItem):
            Cotador().cotar(_ped((item,)))


def test_quantidade_zero_ignora_item_antes_de_validar():
    c = Cotador().cotar(_ped((Item(0, -5, -5, -5, 0), Item(700, 0, 0, 0))))
    assert c.volumes == 1 and c.peso_taxavel_g == 700


def test_dimensao_zero_e_valida():
    assert Cotador().cotar(_ped((Item(500, 0, 30, 30),))).peso_taxavel_g == 500


def test_pedido_vazio():
    for itens in ((), [], (Item(500, 0, 0, 0, 0),)):
        with pytest.raises(ErroPedidoVazio):
            Cotador().cotar(_ped(itens))


def test_itens_aceita_lista_e_tupla():
    a = Cotador().cotar(_ped([Item(500, 0, 0, 0)]))
    b = Cotador().cotar(_ped((Item(500, 0, 0, 0),)))
    assert a == b


def test_ordem_das_verificacoes():
    c = Cotador()
    # item inválido vem antes de tudo
    with pytest.raises(ErroItem):
        c.cotar(_ped((Item(0, 0, 0, 0),), cep="x"))
    # item inválido depois de itens bons ainda é o primeiro erro
    with pytest.raises(ErroItem):
        c.cotar(_ped((Item(40000, 0, 0, 0), Item(-1, 0, 0, 0)), cep="x"))
    # vazio antes de CEP
    with pytest.raises(ErroPedidoVazio):
        c.cotar(_ped((), cep="x"))
    # CEP antes de peso
    with pytest.raises(ErroCep):
        c.cotar(_ped((Item(40000, 0, 0, 0),), cep="x"))
    # peso antes de serviço
    with pytest.raises(ErroPeso):
        c.cotar(_ped((Item(40000, 0, 0, 0),), cep="69000000", servico="X"))
    with pytest.raises(ErroServico):
        c.cotar(_ped((Item(500, 0, 0, 0),), cep="69000000", servico="X"))


def test_peso_limite_sobe_para_centena_antes_de_comparar():
    c = Cotador()
    assert c.cotar(_ped((Item(30000, 0, 0, 0),))).peso_taxavel_g == 30000
    with pytest.raises(ErroPeso):
        c.cotar(_ped((Item(29000, 0, 0, 0), Item(1001, 0, 0, 0))))
    with pytest.raises(ErroPeso):
        c.cotar(_ped((Item(20000, 0, 0, 0, 2),)))


def test_servico_x_na_zona_5():
    for cep in ("69012-345", "68000000", "79123456"):
        with pytest.raises(ErroServico):
            Cotador().cotar(_ped((Item(500, 0, 0, 0),), cep=cep, servico="x"))
    assert (
        Cotador()
        .cotar(_ped((Item(500, 0, 0, 0),), cep="69012345", servico="E"))
        .servico
        == "E"
    )


def test_origem_configuravel_e_zona_local():
    c = Cotador("04567-000")
    assert c.cotar(_ped((Item(500, 0, 0, 0),), cep="04567999")).zona == 0
    assert c.cotar(_ped((Item(500, 0, 0, 0),), cep="01310200")).zona == 1
    assert (
        Cotador("69012-000").cotar(_ped((Item(500, 0, 0, 0),), cep="69012999")).zona
        == 0
    )
    assert Cotador().cotar(_ped((Item(500, 0, 0, 0),), cep="01310100")).zona == 0
    for ruim in ("123", "00000000", "abc"):
        with pytest.raises(ErroCep):
            Cotador(ruim)


def test_numeracao_historico_e_acumulado():
    c = Cotador()
    assert c.historico == () and c.total_acumulado == 0
    a = c.cotar(_ped((Item(500, 0, 0, 0),)))
    with pytest.raises(ErroCep):
        c.cotar(_ped((Item(500, 0, 0, 0),), cep="x"))
    b = c.cotar(_ped((Item(500, 0, 0, 0),), cep="90000000"))
    assert (a.numero, b.numero) == (1, 2)
    assert c.historico == (a, b)
    assert c.total_acumulado == a.total_centavos + b.total_centavos
    assert isinstance(c.historico, tuple)


def test_instancias_independentes():
    c1, c2 = Cotador(), Cotador()
    c1.cotar(_ped((Item(500, 0, 0, 0),)))
    c1.cotar(_ped((Item(500, 0, 0, 0),)))
    assert c2.cotar(_ped((Item(500, 0, 0, 0),))).numero == 1
    assert len(c1.historico) == 2 and len(c2.historico) == 1


def test_modelos_imutaveis_e_sem_validacao():
    item = Item(500, 1, 2, 3)
    assert (item.quantidade, item.valor_centavos) == (1, 0)
    with pytest.raises(AttributeError):
        item.peso_g = 1
    ped = Pedido("x", ())
    assert (ped.servico, ped.cupom) == ("N", "")
    with pytest.raises(AttributeError):
        ped.cupom = "a"
    c = Cotador().cotar(_ped((Item(500, 0, 0, 0),)))
    assert isinstance(c.avisos, tuple) and dataclasses.is_dataclass(c)
    with pytest.raises(AttributeError):
        c.total_centavos = 0
    assert c.total_centavos == c.frete_centavos + c.seguro_centavos


def test_frete_nao_importa_legacy():
    codigo = "import sys, frete; sys.exit(1 if any(m == 'legacy' or m.startswith('legacy.') for m in sys.modules) else 0)"
    assert subprocess.run([sys.executable, "-c", codigo], cwd=RAIZ).returncode == 0  # noqa: PLW1510
    for arq in (RAIZ / "frete").rglob("*.py"):
        for no in ast.walk(ast.parse(arq.read_text(encoding="utf-8"))):
            mods = [a.name for a in no.names] if isinstance(no, ast.Import) else []
            if isinstance(no, ast.ImportFrom) and no.level == 0:
                mods = [no.module or ""]
            assert not any(m == "legacy" or m.startswith("legacy.") for m in mods), arq


def test_formata_moeda():
    casos = {
        0: "R$ 0,00",
        5: "R$ 0,05",
        99: "R$ 0,99",
        100: "R$ 1,00",
        123456: "R$ 1.234,56",
        100000000: "R$ 1.000.000,00",
        99999: "R$ 999,99",
    }
    for centavos, texto in casos.items():
        assert formata_moeda(centavos) == texto


def test_formata_peso():
    casos = {
        0: "0,0 kg",
        99: "0,0 kg",
        100: "0,1 kg",
        2300: "2,3 kg",
        2399: "2,3 kg",
        12500: "12,5 kg",
        30000: "30,0 kg",
    }
    for gramas, texto in casos.items():
        assert formata_peso(gramas) == texto


def test_etiqueta_e_csv_do_spec():
    k = Cotador()
    c1 = k.cotar(
        Pedido("04567-000", (Item(1200, 30, 20, 10, 2, 15000),), "E", "frete10")
    )
    c2 = k.cotar(
        Pedido(
            "69.012-345",
            (Item(4000, 40, 30, 30, 1, 120000), Item(250, 0, 0, 0, 12)),
            "turbo",
            "abc",
        )
    )
    assert (
        etiqueta(c1)
        == "COTACAO #0001\nDestino: 04567-000 (zona 1)\nServico: EXPRESSO\nPeso taxavel: 2,4 kg\nVolumes: 2\nFrete:          R$ 29,70\nTotal:          R$ 29,70\nPrazo: 1 dia util"
    )
    assert linha_csv(c1) == "0001;04567000;1;E;2400;2;2970;0;2970;1"
    assert (
        etiqueta(c2)
        == "COTACAO #0002\nDestino: 69012-345 (zona 5)\nServico: NORMAL\nPeso taxavel: 9,0 kg\nVolumes: 13\nFrete:         R$ 120,45\nSeguro:          R$ 7,00\nTotal:         R$ 127,45\nPrazo: 14 dias uteis\nAviso: servico desconhecido: turbo\nAviso: cupom desconhecido: ABC"
    )
    assert linha_csv(c2) == "0002;69012345;5;N;9000;13;12045;700;12745;14"
    assert k.total_acumulado == 15715


def test_etiqueta_so_depende_da_cotacao():
    c = Cotacao(
        numero=12,
        cep_destino="01310100",
        zona=0,
        servico="X",
        peso_taxavel_g=500,
        volumes=1,
        frete_centavos=1200,
        seguro_centavos=0,
        total_centavos=1200,
        prazo_dias=1,
    )
    assert c.avisos == ()
    assert (
        etiqueta(c)
        == "COTACAO #0012\nDestino: 01310-100 (zona 0)\nServico: EXTREMO\nPeso taxavel: 0,5 kg\nVolumes: 1\nFrete:          R$ 12,00\nTotal:          R$ 12,00\nPrazo: 1 dia util"
    )
    assert linha_csv(c) == "0012;01310100;0;X;500;1;1200;0;1200;1"
    c = Cotacao(12345, "01310100", 3, "N", 500, 1, 1000000, 5, 1000005, 6, ("a", "b"))
    linhas = etiqueta(c).split("\n")
    assert linhas[0] == "COTACAO #12345"
    assert linhas[5] == "Frete:      R$ 10.000,00"
    assert linhas[6] == "Seguro:          R$ 0,05"
    assert linhas[-3:] == ["Prazo: 6 dias uteis", "Aviso: a", "Aviso: b"]
