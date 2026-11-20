import pytest
from reportkit.errors import ReadError, ReportError
from reportkit.reader import read_rows

HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct"


def test_rows_and_line_numbers():
    text = f"# comment\n{HEADER},notes\n\nA1,2024-01-03, north ,Widget,4,25.00,,x\n# skipped\nA2,2024-01-04,SOUTH,W,1,1,5,y\n"
    rows = read_rows(text)
    assert [row.line for row in rows] == [4, 6]
    assert rows[0].fields["region"] == "north"
    assert rows[0].fields["discount_pct"] == ""
    assert "notes" not in rows[0].fields


def test_quoted_fields_and_crlf():
    text = f'\ufeff{HEADER}\r\nA1,2024-01-03,NORTH,"Gadget, ""XL""\nblue",4,25.00,\r\nA2,2024-01-04,EAST,W,1,1,\r\n'
    rows = read_rows(text)
    assert rows[0].fields["product"] == 'Gadget, "XL"\nblue'
    assert [row.line for row in rows] == [2, 4]


def test_columns_in_any_order():
    rows = read_rows(
        "quantity,product,region,date,order_id,discount_pct,unit_price\n2,W,EAST,2024-01-01,A1,,3.50\n"
    )
    assert rows[0].fields["order_id"] == "A1" and rows[0].fields["unit_price"] == "3.50"


def test_read_errors():
    cases = {
        "": "missing header",
        "order_id,date\n": "line 1: missing column 'region'",
        f"{HEADER},date\n": "line 1: duplicate column 'date'",
        f"{HEADER}\nA1,2024-01-03\n": "line 2: expected 7 fields, got 2",
        f'{HEADER}\nA1,2024-01-03,NORTH,"W,1,1,\n': "line 2: unterminated quoted field",
        f'{HEADER}\nA1,2024-01-03,NORTH,"W"x,1,1,\n': "line 2: unexpected character after closing quote",
    }
    for text, message in cases.items():
        with pytest.raises(ReadError) as info:
            read_rows(text)
        assert str(info.value) == message
        assert isinstance(info.value, ReportError)
