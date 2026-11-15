"""Texto de diagnósticos."""

from cfgparse.parser.diagnostics import Diagnostic


def format_diagnostics(diags: list[Diagnostic]) -> str:
    return "\n".join(str(d) for d in diags)
