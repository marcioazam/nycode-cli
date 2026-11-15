"""Stage 5: Summary or MonthlyReport -> machine-readable text (SPEC sections 6, 7 and 9)."""

from reportkit.errors import ExportError
from reportkit.export.csv_out import summary_csv
from reportkit.export.json_out import summary_json
from reportkit.export.monthly_out import monthly_csv, monthly_json
from reportkit.models import MonthlyReport

__all__ = ["export"]

_WRITERS = {
    (False, "csv"): summary_csv,
    (False, "json"): summary_json,
    (True, "csv"): monthly_csv,
    (True, "json"): monthly_json,
}


def export(report, fmt):
    writer = _WRITERS.get((isinstance(report, MonthlyReport), fmt))
    if writer is None:
        raise ExportError(f"unknown format '{fmt}'")
    return writer(report)
