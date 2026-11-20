"""R11 e R12: share, subtotais e total do relatório monthly, conferida pelo JSON."""

import json

from reportkit.pipeline import run

HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct,status\n"


def monthly(rows):
    body = "".join(f"{number},{row}\n" for number, row in enumerate(rows, 1))
    return json.loads(run(HEADER + body, "json", "monthly"))


def cells(month, key):
    return [(region["region"], region[key]) for region in month["regions"]]


def test_r11_maior_resto_soma_cem():
    document = monthly(
        [
            "2024-01-01,WEST,A,1,10.00,,",
            "2024-01-02,SOUTH,A,1,10.00,,",
            "2024-01-03,EAST,A,1,10.00,,",
            "2024-02-01,WEST,A,1,10.00,,",
            "2024-02-02,SOUTH,A,1,10.00,,",
            "2024-02-03,EAST,A,1,10.00,,",
            "2024-02-04,NORTH,A,1,30.00,,",
            "2024-03-01,NORTH,A,1,1.00,,",
            "2024-03-02,EAST,A,1,2.00,,",
            "2024-03-03,SOUTH,A,1,4.00,,",
        ]
    )
    january, february, march = document["months"]
    assert cells(january, "share") == [
        ("WEST", "33.4"),
        ("SOUTH", "33.3"),
        ("EAST", "33.3"),
    ]
    assert cells(february, "share") == [
        ("NORTH", "50.0"),
        ("WEST", "16.7"),
        ("SOUTH", "16.7"),
        ("EAST", "16.6"),
    ]
    # 4/7 = 57.142..., 2/7 = 28.571..., 1/7 = 14.285...: o décimo que falta vai para o maior resto (2/7)
    assert cells(march, "share") == [
        ("SOUTH", "57.1"),
        ("EAST", "28.6"),
        ("NORTH", "14.3"),
    ]
    assert [month["share"] for month in document["months"]] == [
        "100.0",
        "100.0",
        "100.0",
    ]


def test_r11_maior_resto_nao_e_arredondamento_simples():
    document = monthly(
        [
            "2024-01-01,NORTH,A,1,398.50,,",
            "2024-01-02,WEST,A,1,0.50,,",
            "2024-01-03,EAST,A,1,0.50,,",
            "2024-01-04,SOUTH,A,1,0.50,,",
        ]
    )
    shares = cells(document["months"][0], "share")
    # Partes inteiras 996 + 1 + 1 + 1 = 999 décimos; o décimo que falta vai para a primeira da ordem (restos iguais).
    # O arredondamento simples daria 99.6 + 0.1 + 0.1 + 0.1 = 99.9.
    assert shares == [
        ("NORTH", "99.7"),
        ("WEST", "0.1"),
        ("EAST", "0.1"),
        ("SOUTH", "0.1"),
    ]


def test_r11_net_zero_do_mes():
    document = monthly(
        [
            "2024-01-01,WEST,A,3,0.00,,",
            "2024-01-02,EAST,A,2,10.00,100,",
            "2024-01-03,NORTH,A,1,10.00,,refunded",
        ]
    )
    month = document["months"][0]
    assert cells(month, "share") == [("WEST", "0.0"), ("EAST", "0.0"), ("NORTH", "0.0")]
    assert (month["share"], month["orders"], month["units"], month["gross"]) == (
        "0.0",
        2,
        5,
        "20.00",
    )
    assert (month["discount"], month["net"], month["refunded"]) == (
        "20.00",
        "0.00",
        "10.00",
    )


def test_r12_subtotais_total_e_media():
    document = monthly(
        [
            "2024-01-01,WEST,A,1,10.00,,",
            "2024-01-02,EAST,A,2,0.01,,",
            "2024-03-03,EAST,A,1,0.01,,",
            "2024-03-04,EAST,A,5,1.00,,refunded",
        ]
    )
    january, february, march = document["months"]
    assert (january["orders"], january["units"], january["net"], january["share"]) == (
        2,
        3,
        "10.02",
        "100.0",
    )
    assert (february["orders"], february["net"], february["share"]) == (
        0,
        "0.00",
        "0.0",
    )
    assert (march["orders"], march["net"], march["refunded"], march["share"]) == (
        1,
        "0.01",
        "5.00",
        "100.0",
    )
    assert (document["orders"], document["units"], document["gross"]) == (3, 4, "10.03")
    assert (document["net"], document["refunded"]) == ("10.03", "5.00")
    # 10.03 / 3 = 3.3433... -> 3.34
    assert document["average_order"] == "3.34"
    assert "share" not in document
    half = monthly(["2024-01-01,WEST,A,1,10.00,,", "2024-01-02,EAST,A,1,0.01,,"])
    # 10.01 / 2 = 5.005 -> 5.01 (meio para cima)
    assert half["average_order"] == "5.01"
    only_refunds = monthly(["2024-01-01,WEST,A,1,10.00,,refunded"])
    assert (
        only_refunds["orders"],
        only_refunds["average_order"],
        only_refunds["refunded"],
    ) == (0, "0.00", "10.00")
