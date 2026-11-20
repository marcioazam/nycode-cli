"""Espaços em branco."""

from docflow.plugin import Plugin


class Strip(Plugin):
    name = "strip"
    priority = 10

    def apply(self, text):
        return text.strip()


class Collapse(Plugin):
    name = "collapse"
    priority = 20

    def apply(self, text):
        return " ".join(text.split())
