import json
from pathlib import Path

import pytest
import reportkit
from reportkit.errors import ExportError
from reportkit.pipeline import run

SAMPLE = Path(__file__).resolve().parent.parent / "data" / "orders.csv"
HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct\n"

TEXT = """\
SALES REPORT
Period: 2024-01-03 to 2024-04-01
Orders: 6
Units: 27
Gross: 848.25
Discount: 63.66
Net: 784.59
Average order: 130.77

REGION / PRODUCT        ORDERS   UNITS         GROSS      DISCOUNT           NET   SHARE
NORTH                        2       6        299.90          5.00        294.90   37.6%
  Gadget                     1       2        199.90          5.00        194.90
  Widget                     1       4        100.00          0.00        100.00
SOUTH                        2       4        274.90         19.99        254.91   32.5%
  Gadget, large              1       1        199.90         19.99        179.91
  Widget                     1       3         75.00          0.00         75.00
EAST                         1      10        250.00         37.50        212.50   27.1%
  Widget                     1      10        250.00         37.50        212.50
WEST                         1       7         23.45          1.17         22.28    2.8%
  Cable                      1       7         23.45          1.17         22.28
TOTAL                        6      27        848.25         63.66        784.59
"""


def sample():
    with open(SAMPLE, encoding="utf-8", newline="") as handle:
        return handle.read()


def test_text_report_of_the_sample():
    assert run(sample()) == TEXT
    assert reportkit.run(sample(), "text") == TEXT


def test_csv_report_of_the_sample():
    lines = run(sample(), "csv").split("\r\n")
    assert lines[0] == "region,product,orders,units,gross,discount,net,share"
    assert lines[1] == "NORTH,,2,6,299.90,5.00,294.90,37.6"
    assert lines[5] == 'SOUTH,"Gadget, large",1,1,199.90,19.99,179.91,'
    assert lines[-2] == "TOTAL,,6,27,848.25,63.66,784.59,"
    assert lines[-1] == ""


def test_json_report_of_the_sample():
    output = run(sample(), "json")
    document = json.loads(output)
    assert output.endswith("}\n")
    assert document["report"] == "summary"
    assert (document["first_date"], document["last_date"]) == (
        "2024-01-03",
        "2024-04-01",
    )
    assert (document["orders"], document["net"], document["average_order"]) == (
        6,
        "784.59",
        "130.77",
    )
    assert [region["region"] for region in document["regions"]] == [
        "NORTH",
        "SOUTH",
        "EAST",
        "WEST",
    ]
    assert document["regions"][3]["products"] == [
        {
            "product": "Cable",
            "orders": 1,
            "units": 7,
            "gross": "23.45",
            "discount": "1.17",
            "net": "22.28",
        }
    ]


def test_ties_long_names_and_thousands():
    body = (
        "1,2024-03-01,WEST,A product with a very long name,1000,1234.50,\n"
        "2,2024-03-02,EAST,Tab\there,1000,1234.50,\n"
    )
    lines = run(HEADER + body).split("\n")
    assert (
        lines[10]
        == "EAST                         1    1000  1,234,500.00          0.00  1,234,500.00   50.0%"
    )
    assert (
        lines[11]
        == "  Tab here                   1    1000  1,234,500.00          0.00  1,234,500.00"
    )
    assert lines[13].startswith("  A product with a ...       1")


def test_empty_input_and_unknown_format():
    lines = run(HEADER).split("\n")
    assert lines[1] == "Period: -"
    assert lines[7] == "Average order: 0.00"
    assert (
        lines[10]
        == "TOTAL                        0       0          0.00          0.00          0.00"
    )
    assert json.loads(run(HEADER, "json"))["first_date"] is None
    with pytest.raises(ExportError) as info:
        run(HEADER, "xml")
    assert str(info.value) == "unknown format 'xml'"
