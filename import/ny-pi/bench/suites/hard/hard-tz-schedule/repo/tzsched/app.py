"""Ponto de entrada: registros → relatório semanal."""

from datetime import date

from tzsched.io.store import load_calendar
from tzsched.report.format import render
from tzsched.report.weekly import weekly_report


def week_text(records: list[dict], zone: str, monday: date) -> str:
    return render(weekly_report(load_calendar(records), zone, monday))
