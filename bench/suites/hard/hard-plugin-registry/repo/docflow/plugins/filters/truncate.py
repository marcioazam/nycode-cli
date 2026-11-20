"""Limita o tamanho do texto."""

from docflow.plugin import Plugin
from docflow.registry import register

LIMIT = 40


@register
class Truncate(Plugin):
    name = "truncate"
    priority = 90

    def apply(self, text):
        if len(text) <= LIMIT:
            return text
        return text[: LIMIT - 3] + "..."
