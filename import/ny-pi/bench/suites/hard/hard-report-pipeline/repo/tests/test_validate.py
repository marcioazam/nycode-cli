import datetime
from decimal import Decimal

import pytest
from reportkit.errors import ValidationError
from reportkit.reader import read_rows
from reportkit.validate import validate_rows

HEADER = "order_id,date,region,product,quantity,unit_price,discount_pct\n"


def orders_of(body):
    return validate_rows(read_rows(HEADER + body))


def test_valid_rows_become_orders():
    orders = orders_of(
        "A1,2024-01-03,north,Widget,4,25.5,\nA2,2024-02-29,West,Gadget,1,199.90,12.5\n"
    )
    first, second = orders
    assert (first.line, first.order_id, first.region, first.product) == (
        2,
        "A1",
        "NORTH",
        "Widget",
    )
    assert first.date == datetime.date(2024, 1, 3)
    assert (first.quantity, first.unit_price, first.discount_pct) == (
        4,
        Decimal("25.5"),
        Decimal(0),
    )
    assert (second.region, second.discount_pct) == ("WEST", Decimal("12.5"))


def test_every_message_is_collected_in_order():
    body = (
        ",2024-13-01,MOON,,0,1.234,101\n"
        "A1,2024-01-03,NORTH,W,1,1,\n"
        "A1,03/01/2024,NORTH,W,-1,abc,1.5.0\n"
        "A2,2023-02-29,SOUTH,W,1.0,.5,100.01\n"
    )
    with pytest.raises(ValidationError) as info:
        orders_of(body)
    assert info.value.errors == [
        "line 2: order_id: empty",
        "line 2: date: invalid date '2024-13-01'",
        "line 2: region: unknown region 'MOON'",
        "line 2: product: empty",
        "line 2: quantity: invalid quantity '0'",
        "line 2: unit_price: invalid amount '1.234'",
        "line 2: discount_pct: invalid percentage '101'",
        "line 4: order_id: duplicate of line 3",
        "line 4: date: invalid date '03/01/2024'",
        "line 4: quantity: invalid quantity '-1'",
        "line 4: unit_price: invalid amount 'abc'",
        "line 4: discount_pct: invalid percentage '1.5.0'",
        "line 5: date: invalid date '2023-02-29'",
        "line 5: quantity: invalid quantity '1.0'",
        "line 5: unit_price: invalid amount '.5'",
        "line 5: discount_pct: invalid percentage '100.01'",
    ]
    assert str(info.value) == "\n".join(info.value.errors)


def test_id_of_an_invalid_row_is_still_registered():
    with pytest.raises(ValidationError) as info:
        orders_of("A1,bad,NORTH,W,1,1,\nA1,2024-01-03,NORTH,W,1,1,\n")
    assert info.value.errors == [
        "line 2: date: invalid date 'bad'",
        "line 3: order_id: duplicate of line 2",
    ]
