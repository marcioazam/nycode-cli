"""Renderização textual do relatório."""

from ledger.model.currency import exponent
from ledger.report.builder import Line
from ledger.report.summary import Totals
from ledger.util.text import format_amount, pad


def render(lines: list[Line], totals: Totals, currency: str) -> str:
    exp = exponent(currency)
    rows = [
        f"{pad('id', 8)}{pad('net', 12, True)}{pad('tax', 10, True)}{pad('gross', 12, True)}"
    ]
    for l in lines:
        rows.append(
            pad(l.entry_id, 8)
            + pad(format_amount(l.net, exp), 12, True)
            + pad(format_amount(l.tax, exp), 10, True)
            + pad(format_amount(l.gross, exp), 12, True)
        )
    rows.append(
        pad("TOTAL", 8)
        + pad(format_amount(totals.net, exp), 12, True)
        + pad(format_amount(totals.tax, exp), 10, True)
        + pad(format_amount(totals.gross, exp), 12, True)
    )
    return "\n".join(rows)
