"""Markdown: remove os marcadores de título."""

from docflow.plugin import Plugin
from docflow.registry import register


@register
class Headings(Plugin):
    name = "headings"
    priority = 40

    def apply(self, text):
        lines = [
            line.lstrip("#").lstrip() if line.startswith("#") else line
            for line in text.split("\n")
        ]
        return "\n".join(lines)
