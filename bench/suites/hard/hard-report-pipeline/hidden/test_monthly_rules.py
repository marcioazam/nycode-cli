"""R8 a R10: agregação do relatório monthly, conferida pelo JSON."""

import json

from reportkit.pipeline import run

HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct,status\n"


def monthly(rows):
    body = "".join(f"{number},{row}\n" for number, row in enumerate(rows, 1))
    return json.loads(run(HEADER + body, "json", "monthly"))


def cells(month, key):
    return [(region["region"], region[key]) for region in month["regions"]]


def test_r8_paid_refunded_cancelled():
    document = monthly(
        [
            "2024-05-01,NORTH,A,3,0.35,15,",
            "2024-05-02,NORTH,B,1,0.50,1,paid",
            "2024-05-03,NORTH,A,3,0.35,15,refunded",
            "2024-05-04,NORTH,A,100,9.99,,cancelled",
            "2024-05-31,SOUTH,A,2,10.00,50,refunded",
            "2024-06-01,SOUTH,A,2,10.00,25,",
        ]
    )
    may, june = document["months"]
    assert (may["month"], june["month"]) == ("2024-05", "2024-06")
    # 1.05 * 15% = 0.1575 -> 0.16; 0.50 * 1% = 0.005 -> 0.01 (arredondado pedido a pedido)
    north = {
        "region": "NORTH",
        "orders": 2,
        "units": 4,
        "gross": "1.55",
        "discount": "0.17",
        "net": "1.38",
    }
    assert may["regions"][0] == {**north, "refunded": "0.89", "share": "100.0"}
    south = {
        "region": "SOUTH",
        "orders": 0,
        "units": 0,
        "gross": "0.00",
        "discount": "0.00",
        "net": "0.00",
    }
    assert may["regions"][1] == {**south, "refunded": "10.00", "share": "0.0"}
    assert (may["orders"], may["units"], may["gross"], may["discount"]) == (
        2,
        4,
        "1.55",
        "0.17",
    )
    assert (may["net"], may["refunded"], may["share"]) == ("1.38", "10.89", "100.0")
    assert cells(june, "net") == [("SOUTH", "15.00")]
    assert (document["orders"], document["units"], document["gross"]) == (3, 6, "21.55")
    assert (document["discount"], document["net"], document["refunded"]) == (
        "5.17",
        "16.38",
        "10.89",
    )


def test_r9_meses_intermediarios_entre_anos():
    document = monthly(
        [
            "2024-02-10,NORTH,A,1,5.00,,",
            "2023-11-30,SOUTH,A,1,7.00,,",
            "2024-03-01,NORTH,A,1,1.00,,cancelled",
            "2023-09-01,NORTH,A,1,1.00,,Cancelled",
        ]
    )
    months = document["months"]
    assert [month["month"] for month in months] == [
        "2023-11",
        "2023-12",
        "2024-01",
        "2024-02",
    ]
    assert (document["first_month"], document["last_month"]) == ("2023-11", "2024-02")
    empty = {
        "orders": 0,
        "units": 0,
        "gross": "0.00",
        "discount": "0.00",
        "net": "0.00",
        "refunded": "0.00",
    }
    for index in (1, 2):
        assert months[index] == {
            "month": months[index]["month"],
            **empty,
            "share": "0.0",
            "regions": [],
        }
    assert cells(months[0], "net") == [("SOUTH", "7.00")]
    assert cells(months[3], "net") == [("NORTH", "5.00")]


def test_r9_refunded_define_o_periodo_e_mes_unico():
    document = monthly(
        ["2024-12-31,WEST,A,1,5.00,,refunded", "2025-02-01,EAST,A,1,5.00,,"]
    )
    assert [month["month"] for month in document["months"]] == [
        "2024-12",
        "2025-01",
        "2025-02",
    ]
    single = monthly(["2024-07-01,WEST,A,1,5.00,,", "2024-07-31,WEST,A,1,5.00,,"])
    assert [month["month"] for month in single["months"]] == ["2024-07"]


def test_r9_sem_pedidos_validos_nao_ha_meses():
    for rows in ([], ["2024-03-01,NORTH,A,1,1.00,,cancelled"]):
        document = monthly(rows)
        assert document["months"] == []
        assert document["first_month"] is None and document["last_month"] is None
        assert (document["orders"], document["net"], document["average_order"]) == (
            0,
            "0.00",
            "0.00",
        )


def test_r10_net_decrescente_e_empate_pela_primeira_aparicao():
    document = monthly(
        [
            "2024-01-01,WEST,A,1,10.00,,",
            "2024-01-02,SOUTH,A,1,10.00,,",
            "2024-01-03,EAST,A,1,10.00,,",
            "2024-01-04,NORTH,A,1,30.00,,",
            "2024-02-01,SOUTH,A,1,4.00,,",
            "2024-02-02,NORTH,A,1,6.00,,",
            "2024-02-03,SOUTH,A,1,2.00,,",
            "2024-02-04,EAST,A,1,9.00,,",
        ]
    )
    january, february = document["months"]
    assert [name for name, _ in cells(january, "net")] == [
        "NORTH",
        "WEST",
        "SOUTH",
        "EAST",
    ]
    assert cells(february, "net") == [
        ("EAST", "9.00"),
        ("SOUTH", "6.00"),
        ("NORTH", "6.00"),
    ]


def test_r10_aparicao_ignora_cancelados_e_vale_por_mes():
    document = monthly(
        [
            "2024-01-01,EAST,A,1,5.00,,cancelled",
            "2024-01-02,WEST,A,1,5.00,,",
            "2024-01-03,SOUTH,A,9,5.00,,refunded",
            "2024-01-04,EAST,A,1,5.00,,",
            "2024-01-05,SOUTH,A,1,5.00,,",
            "2024-01-06,NORTH,A,2,5.00,,refunded",
            "2024-02-01,EAST,A,1,5.00,,",
            "2024-02-02,WEST,A,1,5.00,,",
        ]
    )
    january, february = document["months"]
    assert cells(january, "net") == [
        ("WEST", "5.00"),
        ("SOUTH", "5.00"),
        ("EAST", "5.00"),
        ("NORTH", "0.00"),
    ]
    assert cells(january, "refunded")[1] == ("SOUTH", "45.00")
    assert cells(january, "refunded")[3] == ("NORTH", "10.00")
    assert [name for name, _ in cells(february, "net")] == ["EAST", "WEST"]
