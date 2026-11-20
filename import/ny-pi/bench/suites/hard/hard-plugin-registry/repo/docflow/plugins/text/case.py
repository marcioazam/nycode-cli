"""Caixa alta e baixa."""

from docflow.plugin import Plugin
from docflow.registry import register


@register
class Lower(Plugin):
    name = "lower"
    priority = 50

    def apply(self, text):
        return text.lower()


@register
class Upper(Plugin):
    name = "upper"
    priority = 50

    def apply(self, text):
        return text.upper()


@register
class Title(Plugin):
    name = "title"
    priority = 60

    def apply(self, text):
        return " ".join(word.capitalize() for word in text.split(" "))
