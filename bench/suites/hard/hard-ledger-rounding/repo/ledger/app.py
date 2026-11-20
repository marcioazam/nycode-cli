"""Ponto de entrada: do registro bruto ao relatório."""

from ledger.calc.fx import Rates
from ledger.config.defaults import REPORT_CURRENCY
from ledger.io.loader import load_records
from ledger.report import builder, render, summary


def build_report(records: list[dict], rates: Rates, target: str = REPORT_CURRENCY):
    """Devolve (linhas, totais)."""
    lines = builder.build(load_records(records), rates, target)
    return lines, summary.totals(lines, target)


def render_report(
    records: list[dict], rates: Rates, target: str = REPORT_CURRENCY
) -> str:
    lines, totals = build_report(records, rates, target)
    return render.render(lines, totals, target)
