"""Filtros de saída."""

from docflow.plugins.filters.redact import RedactDigits
from docflow.plugins.filters.truncate import Truncate

PLUGINS = (RedactDigits, Truncate)


def install(registry):
    """Registra os plugins do grupo no registro dado."""
    for cls in PLUGINS:
        registry.register(cls)
