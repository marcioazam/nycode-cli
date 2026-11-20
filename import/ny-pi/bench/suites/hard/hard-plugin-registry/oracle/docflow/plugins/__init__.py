"""Plugins embutidos, agrupados por subpacote."""

from docflow.plugins import filters, markup, stats, text

GROUPS = ("text", "markup", "stats", "filters")


def install_builtins(registry):
    """Registra todos os plugins embutidos no registro dado."""
    for group in (text, markup, stats, filters):
        group.install(registry)
