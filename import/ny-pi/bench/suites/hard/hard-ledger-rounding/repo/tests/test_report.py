from decimal import Decimal as D

from ledger.app import build_report, render_report
from ledger.calc.fx import Rates

RATES = Rates({("USD", "EUR"): D("0.9")})


def rec(i, amount, cur="EUR", rate="0.10", kind="sale"):
    return {
        "id": i,
        "kind": kind,
        "amount": amount,
        "currency": cur,
        "date": "2024-02-01",
        "tax_rate": rate,
    }


def test_simple_report():
    lines, totals = build_report([rec("a", "100.00"), rec("b", "50.00")], RATES)
    assert [l.gross for l in lines] == [D("110.00"), D("55.00")]
    assert (totals.net, totals.tax, totals.gross) == (
        D("150.00"),
        D("15.00"),
        D("165.00"),
    )


def test_fx_line():
    lines, _ = build_report([rec("a", "100.00", "USD")], RATES)
    assert lines[0].net == D("90.00")


def test_render_has_total():
    out = render_report([rec("a", "100.00")], RATES)
    assert out.splitlines()[-1].split() == ["TOTAL", "100.00", "10.00", "110.00"]
