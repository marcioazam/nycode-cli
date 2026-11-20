"""R13 a R16: texto, CSV e JSON do relatório monthly."""

import json

from reportkit.pipeline import run, run_with_warnings

EXAMPLE = """\
order_id,date,region,product,quantity,unit_price,discount_pct,status
1,2023-11-03,west,W,1,10.00,,
2,2023-11-15,EAST,W,1,10.00,,PAID
3,2023-11-15,North,G,1,10.00,,
4,2023-11-20,north,G,3,1000.00,10,refunded
5,2024-01-02,east,W,10,250.00,15,
6,2024-01-17,SOUTH,W,3,25.00,0,cancelled
7,2024-01-30,WEST,C,x,3.35,5,
"""

EXAMPLE_TEXT = """\
MONTHLY REPORT
Period: 2023-11 to 2024-01

MONTH    REGION  ORDERS   UNITS         GROSS      DISCOUNT           NET      REFUNDED   SHARE
2023-11  WEST         1       1         10.00          0.00         10.00          0.00   33.4%
         EAST         1       1         10.00          0.00         10.00          0.00   33.3%
         NORTH        1       1         10.00          0.00         10.00      2,700.00   33.3%
         TOTAL        3       3         30.00          0.00         30.00      2,700.00  100.0%
2023-12  TOTAL        0       0          0.00          0.00          0.00          0.00    0.0%
2024-01  EAST         1      10      2,500.00        375.00      2,125.00          0.00  100.0%
         TOTAL        1      10      2,500.00        375.00      2,125.00          0.00  100.0%
TOTAL                 4      13      2,530.00        375.00      2,155.00      2,700.00

Average order: 538.75
"""

EXAMPLE_CSV = [
    "month,region,orders,units,gross,discount,net,refunded,share",
    "2023-11,WEST,1,1,10.00,0.00,10.00,0.00,33.4",
    "2023-11,EAST,1,1,10.00,0.00,10.00,0.00,33.3",
    "2023-11,NORTH,1,1,10.00,0.00,10.00,2700.00,33.3",
    "2023-11,*,3,3,30.00,0.00,30.00,2700.00,100.0",
    "2023-12,*,0,0,0.00,0.00,0.00,0.00,0.0",
    "2024-01,EAST,1,10,2500.00,375.00,2125.00,0.00,100.0",
    "2024-01,*,1,10,2500.00,375.00,2125.00,0.00,100.0",
    "*,*,4,13,2530.00,375.00,2155.00,2700.00,",
]

HEADER_ONLY = "order_id,date,region,product,quantity,unit_price,discount_pct\n"

EMPTY_TEXT = """\
MONTHLY REPORT
Period: -

MONTH    REGION  ORDERS   UNITS         GROSS      DISCOUNT           NET      REFUNDED   SHARE
TOTAL                 0       0          0.00          0.00          0.00          0.00

Average order: 0.00
"""


def numbers(orders, units, gross, discount, net, refunded):
    keys = ("orders", "units", "gross", "discount", "net", "refunded")
    return dict(zip(keys, (orders, units, gross, discount, net, refunded)))


def test_r16_exemplo_do_spec_em_texto():
    output, warnings = run_with_warnings(EXAMPLE, "text", "monthly", skip_invalid=True)
    assert output == EXAMPLE_TEXT + "Skipped rows: 1\n"
    assert warnings == ["line 8: quantity: invalid quantity 'x'"]


def test_r13_texto_sem_linha_descartada():
    clean = EXAMPLE.rsplit("7,", 1)[0]
    assert run(clean, "text", "monthly") == EXAMPLE_TEXT
    assert run(clean, "text", "monthly", skip_invalid=True) == EXAMPLE_TEXT


def test_r13_texto_vazio():
    assert run(HEADER_ONLY, "text", "monthly") == EMPTY_TEXT


def test_r13_linhas_sem_espaco_no_fim_e_valores_largos():
    text = (
        HEADER_ONLY
        + "1,2024-01-01,NORTH,A,123456,99999.99,\n2,2024-01-02,SOUTH,A,1,1.00,\n"
    )
    lines = run(text, "text", "monthly").split("\n")
    assert all(line == line.rstrip() for line in lines)
    assert (
        lines[4]
        == "2024-01  NORTH        1  123456  12,345,598,765.44          0.00  12,345,598,765.44          0.00  100.0%"
    )
    assert (
        lines[5]
        == "         SOUTH        1       1          1.00          0.00          1.00          0.00    0.0%"
    )
    assert lines[7].startswith("TOTAL                 2  123457  12,345,598,766.44")
    assert lines[8:] == ["", "Average order: 6,172,799,383.22", ""]


def test_r14_csv_do_exemplo():
    output = run(EXAMPLE, "csv", "monthly", skip_invalid=True)
    assert output == "".join(line + "\r\n" for line in EXAMPLE_CSV)


def test_r14_csv_vazio_tem_total_geral():
    expected = "month,region,orders,units,gross,discount,net,refunded,share\r\n*,*,0,0,0.00,0.00,0.00,0.00,\r\n"
    assert run(HEADER_ONLY, "csv", "monthly") == expected


def test_r15_json_do_exemplo():
    output = run(EXAMPLE, "json", "monthly", skip_invalid=True)
    assert (
        output.startswith('{\n  "')
        and output.endswith("}\n")
        and not output.endswith("\n\n")
    )
    assert json.loads(output) == {
        "report": "monthly",
        "first_month": "2023-11",
        "last_month": "2024-01",
        **numbers(4, 13, "2530.00", "375.00", "2155.00", "2700.00"),
        "average_order": "538.75",
        "months": [
            {
                "month": "2023-11",
                **numbers(3, 3, "30.00", "0.00", "30.00", "2700.00"),
                "share": "100.0",
                "regions": [
                    {
                        "region": "WEST",
                        **numbers(1, 1, "10.00", "0.00", "10.00", "0.00"),
                        "share": "33.4",
                    },
                    {
                        "region": "EAST",
                        **numbers(1, 1, "10.00", "0.00", "10.00", "0.00"),
                        "share": "33.3",
                    },
                    {
                        "region": "NORTH",
                        **numbers(1, 1, "10.00", "0.00", "10.00", "2700.00"),
                        "share": "33.3",
                    },
                ],
            },
            {
                "month": "2023-12",
                **numbers(0, 0, "0.00", "0.00", "0.00", "0.00"),
                "share": "0.0",
                "regions": [],
            },
            {
                "month": "2024-01",
                **numbers(1, 10, "2500.00", "375.00", "2125.00", "0.00"),
                "share": "100.0",
                "regions": [
                    {
                        "region": "EAST",
                        **numbers(1, 10, "2500.00", "375.00", "2125.00", "0.00"),
                        "share": "100.0",
                    },
                ],
            },
        ],
    }


def test_r15_json_vazio():
    assert json.loads(run(HEADER_ONLY, "json", "monthly")) == {
        "report": "monthly",
        "first_month": None,
        "last_month": None,
        **numbers(0, 0, "0.00", "0.00", "0.00", "0.00"),
        "average_order": "0.00",
        "months": [],
    }
