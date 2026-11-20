from decimal import Decimal as D

from ledger.app import build_report, render_report
from ledger.calc.fx import Rates

RATES = Rates({("USD", "EUR"): D("0.925")})


def rec(i, amount, cur="EUR", rate="0.05", kind="sale", date="2024-03-01"):
    return {
        "id": i,
        "kind": kind,
        "amount": amount,
        "currency": cur,
        "date": date,
        "tax_rate": rate,
    }


def test_tax_ties_in_report_lines():
    lines, _ = build_report([rec("a", "10.50")], RATES)
    assert lines[0].tax == D("0.53") and lines[0].gross == D("11.03")


def test_totals_equal_sum_of_tax_lines():
    lines, totals = build_report([rec(c, "10.50") for c in "abc"], RATES)
    assert totals.tax == sum(l.tax for l in lines) == D("1.59")


def test_totals_equal_sum_of_net_lines():
    recs = [rec(c, "10.10", "USD", "0") for c in "abc"]
    lines, totals = build_report(recs, RATES)
    assert [l.net for l in lines] == [D("9.34")] * 3
    assert totals.net == D("28.02") and totals.gross == D("28.02")


def test_totals_columns_consistent():
    recs = [rec("a", "10.50"), rec("b", "3.30", "USD"), rec("c", "-10.50", rate="0.05")]
    lines, t = build_report(recs, RATES)
    assert t.net == sum(l.net for l in lines)
    assert t.tax == sum(l.tax for l in lines)
    assert t.gross == t.net + t.tax == sum(l.gross for l in lines)


def test_refund_tax_negative():
    lines, _ = build_report([rec("r", "-10.50", kind="refund")], RATES)
    assert lines[0].tax == D("-0.53")


def test_fee_and_interest_have_no_tax():
    recs = [
        rec("f", "5.00", kind="fee", rate="0.20"),
        rec("i", "1.00", kind="interest", rate="0.20"),
    ]
    lines, t = build_report(recs, RATES)
    assert [l.tax for l in lines] == [D("0.00"), D("0.00")] and t.tax == D("0.00")


def test_order_by_date_then_id():
    recs = [
        rec("b", "1", date="2024-03-02"),
        rec("z", "1"),
        rec("a", "1", date="2024-03-02"),
    ]
    lines, _ = build_report(recs, RATES)
    assert [l.entry_id for l in lines] == ["z", "a", "b"]


def test_render_total_matches_lines():
    out = render_report([rec(c, "10.50") for c in "abc"], RATES).splitlines()
    assert out[-1].split() == ["TOTAL", "31.50", "1.59", "33.09"]
    assert out[1].split() == ["a", "10.50", "0.53", "11.03"]


def test_jpy_report():
    out = render_report([rec("a", "25", "JPY", "0.10")], RATES, "JPY").splitlines()
    assert out[-1].split() == ["TOTAL", "25", "3", "28"]
