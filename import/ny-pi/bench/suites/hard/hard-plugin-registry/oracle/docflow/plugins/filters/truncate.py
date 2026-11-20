"""Limita o tamanho do texto."""

from docflow.plugin import Plugin

LIMIT = 40


class Truncate(Plugin):
    name = "truncate"
    priority = 90

    def apply(self, text):
        if len(text) <= LIMIT:
            return text
        return text[: LIMIT - 3] + "..."
