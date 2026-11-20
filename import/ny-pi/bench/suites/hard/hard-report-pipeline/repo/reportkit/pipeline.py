"""End-to-end pipeline: read -> validate -> aggregate -> format/export."""

from reportkit.aggregate import aggregate
from reportkit.export import export
from reportkit.formatting import render_text
from reportkit.reader import read_rows
from reportkit.validate import validate_rows


def summarize(text):
    """Run stages 1 to 3 and return the Summary."""
    return aggregate(validate_rows(read_rows(text)))


def run(text, fmt="text"):
    """Run the whole pipeline on CSV text and return the output text."""
    summary = summarize(text)
    if fmt == "text":
        return render_text(summary)
    return export(summary, fmt)
