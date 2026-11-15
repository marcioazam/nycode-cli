"""R1 a R3: coluna status e o efeito dela no relatório summary."""

import json

import pytest
from reportkit.errors import ReadError, ValidationError
from reportkit.pipeline import run

BASE = "order_id,date,region,product,quantity,unit_price,discount_pct"


def test_r1_sem_coluna_status_todos_sao_paid():
    text = BASE + "\n1,2024-01-03,NORTH,W,2,10.00,\n2,2024-01-04,SOUTH,W,1,5.00,\n"
    document = json.loads(run(text, "json"))
    assert (document["orders"], document["net"]) == (2, "25.00")
    monthly = json.loads(run(text, "json", "monthly"))
    assert (monthly["orders"], monthly["net"], monthly["refunded"]) == (
        2,
        "25.00",
        "0.00",
    )


def test_r1_status_em_qualquer_posicao():
    text = (
        "status,order_id,date,region,product,quantity,unit_price,discount_pct,notes\n"
    )
    text += (
        "cancelled,1,2024-01-03,NORTH,W,2,10.00,,x\n,2,2024-01-04,SOUTH,W,1,5.00,,y\n"
    )
    document = json.loads(run(text, "json"))
    assert (document["orders"], document["net"]) == (1, "5.00")


def test_r1_status_duplicado_no_cabecalho():
    with pytest.raises(ReadError) as info:
        run(f"# c\n{BASE},status,status\n")
    assert str(info.value) == "line 2: duplicate column 'status'"


def test_r2_valores_aceitos_sem_diferenciar_caixa():
    text = BASE + ",status\n"
    text += "1,2024-01-03,NORTH,W,1,1.00,,PAID\n"
    text += "2,2024-01-03,NORTH,W,1,2.00,,Paid\n"
    text += "3,2024-01-03,NORTH,W,1,4.00,,\n"
    text += "4,2024-01-03,NORTH,W,1,8.00,,ReFunded\n"
    text += "5,2024-01-03,NORTH,W,1,16.00,,CANCELLED\n"
    monthly = json.loads(run(text, "json", "monthly"))
    assert (monthly["orders"], monthly["net"], monthly["refunded"]) == (
        3,
        "7.00",
        "8.00",
    )


def test_r2_status_desconhecido_e_ordem_das_mensagens():
    text = BASE + ",status\n"
    text += "1,2024-01-03,NORTH,W,1,1.00,,canceled\n"
    text += "2,2024-01-03,NORTH,W,1,1.00,200,Pago\n"
    text += "3,bad,NORTH,W,1,1.00,,paid \n"
    text += '4,2024-01-03,NORTH,W,1,1.00,," paid"\n'
    for report in ("summary", "monthly"):
        with pytest.raises(ValidationError) as info:
            run(text, "csv", report)
        assert info.value.errors == [
            "line 2: status: unknown status 'canceled'",
            "line 3: discount_pct: invalid percentage '200'",
            "line 3: status: unknown status 'Pago'",
            "line 4: date: invalid date 'bad'",
            "line 5: status: unknown status ' paid'",
        ]


ROWS_PAID = "1,2024-02-10,NORTH,W,2,10.00,10\n2,2024-03-05,SOUTH,G,1,99.99,\n"
ROWS_OTHER = (
    "3,2024-01-01,EAST,W,5,10.00,,refunded\n"
    "4,2024-06-30,WEST,Z,5,10.00,,cancelled\n"
    "5,2024-02-11,NORTH,W,7,10.00,,Refunded\n"
)


@pytest.mark.parametrize("fmt", ["text", "csv", "json"])
def test_r3_summary_so_conta_paid(fmt):
    with_status = BASE + ",status\n" + ROWS_PAID.replace("\n", ",paid\n") + ROWS_OTHER
    assert run(with_status, fmt) == run(BASE + "\n" + ROWS_PAID, fmt)


def test_r3_summary_periodo_e_regioes_ignoram_nao_paid():
    text = BASE + ",status\n" + ROWS_PAID.replace("\n", ",\n") + ROWS_OTHER
    document = json.loads(run(text, "json"))
    assert (document["first_date"], document["last_date"]) == (
        "2024-02-10",
        "2024-03-05",
    )
    assert [region["region"] for region in document["regions"]] == ["SOUTH", "NORTH"]
    assert (document["orders"], document["units"], document["net"]) == (2, 3, "117.99")
    only_other = BASE + ",status\n" + ROWS_OTHER
    assert run(only_other).split("\n")[1] == "Period: -"
    assert json.loads(run(only_other, "json"))["regions"] == []
