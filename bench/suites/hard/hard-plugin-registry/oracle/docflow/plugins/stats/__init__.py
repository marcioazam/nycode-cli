"""Observers: reagem aos hooks before_run e after_run."""

from docflow.plugins.stats.audit import Audit
from docflow.plugins.stats.counters import CharCount, WordCount

PLUGINS = (WordCount, CharCount, Audit)


def install(registry):
    """Registra os plugins do grupo no registro dado."""
    for cls in PLUGINS:
        registry.register(cls)
