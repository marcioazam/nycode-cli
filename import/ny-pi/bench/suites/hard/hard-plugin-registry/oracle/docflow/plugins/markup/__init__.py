"""Transformações de marcação (HTML e Markdown)."""

from docflow.plugins.markup.html import Escape, StripTags
from docflow.plugins.markup.markdown import Headings

PLUGINS = (StripTags, Escape, Headings)


def install(registry):
    """Registra os plugins do grupo no registro dado."""
    for cls in PLUGINS:
        registry.register(cls)
