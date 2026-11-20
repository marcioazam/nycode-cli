"""Stage 4: Summary -> human-readable text (SPEC section 5)."""

from reportkit.formatting.summary_text import render_summary

__all__ = ["render_text"]


def render_text(summary):
    """Return the text report; every line ends with a line feed."""
    return "".join(line + "\n" for line in render_summary(summary))
