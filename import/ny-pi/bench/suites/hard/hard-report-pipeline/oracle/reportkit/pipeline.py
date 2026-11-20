"""End-to-end pipeline: read -> validate -> aggregate -> format/export."""

from reportkit.aggregate import aggregate, aggregate_monthly
from reportkit.errors import ExportError, ValidationError
from reportkit.export import export
from reportkit.formatting import render_text
from reportkit.reader import read_rows
from reportkit.validate import check_rows, validate_rows

REPORTS = {"summary": aggregate, "monthly": aggregate_monthly}
FORMATS = ("text", "csv", "json")


def summarize(text):
    """Run stages 1 to 3 and return the Summary."""
    return aggregate(validate_rows(read_rows(text)))


def run_with_warnings(text, fmt="text", report="summary", skip_invalid=False):
    """Run the whole pipeline; return (output text, validation messages of skipped rows)."""
    if report not in REPORTS:
        raise ExportError(f"unknown report '{report}'")
    if fmt not in FORMATS:
        raise ExportError(f"unknown format '{fmt}'")
    orders, errors, rejected = check_rows(read_rows(text))
    if errors and not skip_invalid:
        raise ValidationError(errors)
    data = REPORTS[report](orders)
    if fmt == "text":
        return render_text(data, rejected), errors
    return export(data, fmt), errors


def run(text, fmt="text", report="summary", skip_invalid=False):
    """Run the whole pipeline on CSV text and return the output text."""
    return run_with_warnings(text, fmt, report, skip_invalid)[0]
