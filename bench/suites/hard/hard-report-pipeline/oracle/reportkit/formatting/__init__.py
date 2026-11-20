"""Stage 4: Summary or MonthlyReport -> human-readable text (SPEC sections 5 and 9)."""

from reportkit.formatting.monthly_text import render_monthly
from reportkit.formatting.summary_text import render_summary
from reportkit.models import MonthlyReport

__all__ = ["render_text"]


def render_text(report, skipped=0):
    """Return the text report; every line ends with a line feed."""
    lines = (
        render_monthly(report)
        if isinstance(report, MonthlyReport)
        else render_summary(report)
    )
    if skipped:
        lines.append(f"Skipped rows: {skipped}")
    return "".join(line + "\n" for line in lines)
