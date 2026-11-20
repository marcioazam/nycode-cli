"""Transformações de texto puro."""

from docflow.plugins.text.case import Lower, Title, Upper
from docflow.plugins.text.slug import Slugify
from docflow.plugins.text.whitespace import Collapse, Strip

PLUGINS = (Lower, Upper, Title, Strip, Collapse, Slugify)


def install(registry):
    """Registra os plugins do grupo no registro dado."""
    for cls in PLUGINS:
        registry.register(cls)
