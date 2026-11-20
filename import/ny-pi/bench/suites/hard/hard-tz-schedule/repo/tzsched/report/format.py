"""Texto do relatório semanal."""

from tzsched.report.weekly import DayReport
from tzsched.util.text import WEEKDAYS


def render(report: list[DayReport]) -> str:
    rows = []
    for d in report:
        rows.append(
            f"{WEEKDAYS[d.day.weekday()]} {d.day.isoformat()} total={d.total_min}m"
        )
        for e in d.entries:
            flag = " !" if e.conflict else ""
            rows.append(f"  {e.local_start:%H:%M} {e.title} {e.minutes}m{flag}")
    return "\n".join(rows)
