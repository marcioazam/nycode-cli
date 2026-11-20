"""Stage 5: Summary -> machine-readable text (SPEC sections 6 and 7)."""

from reportkit.errors import ExportError
from reportkit.export.csv_out import summary_csv
from reportkit.export.json_out import summary_json

__all__ = ["export"]


def export(summary, fmt):
    if fmt == "csv":
        return summary_csv(summary)
    if fmt == "json":
        return summary_json(summary)
    raise ExportError(f"unknown format '{fmt}'")
