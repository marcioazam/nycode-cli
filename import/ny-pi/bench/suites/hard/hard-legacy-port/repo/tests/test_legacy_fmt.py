from legacy import frete_fmt

RES = {
    "num": 7,
    "cep": "04567000",
    "zona": 1,
    "serv": "N",
    "peso": 800,
    "vol": 1,
    "frete": 1500,
    "seguro": 0,
    "total": 1500,
    "prazo": 2,
    "avisos": [],
}


def test_moeda_e_peso():
    assert frete_fmt.fmt_moeda(123456) == "R$ 1.234,56"
    assert frete_fmt.fmt_peso(2300) == "2,3 kg"
    assert frete_fmt.fmt_cep("04567000") == "04567-000"


def test_etiqueta():
    linhas = frete_fmt.etiqueta(RES).split("\n")
    assert linhas[0] == "COTACAO #0007"
    assert linhas[-1] == "Prazo: 2 dias uteis"
    assert len(linhas) == 8


def test_linha_csv():
    assert frete_fmt.linha_csv(RES) == "0007;04567000;1;N;800;1;1500;0;1500;2"


def test_fechamento_e_medias():
    texto = frete_fmt.fechamento([RES, RES])
    assert texto.split("\n")[0] == "=" * 15 + "FECHAMENTO" + "=" * 15
    assert texto.split("\n")[-1].endswith("R$ 30,00")
    assert frete_fmt.ticket_medio([]) == 0
    assert frete_fmt.ticket_medio([RES, RES]) == 1500
    assert frete_fmt.maior_cotacao([RES]) is RES
    assert frete_fmt.linhas_csv([RES]).count("\n") == 2
