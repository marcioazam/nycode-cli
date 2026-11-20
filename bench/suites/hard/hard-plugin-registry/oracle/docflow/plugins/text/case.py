"""Caixa alta e baixa."""

from docflow.plugin import Plugin


class Lower(Plugin):
    name = "lower"
    priority = 50

    def apply(self, text):
        return text.lower()


class Upper(Plugin):
    name = "upper"
    priority = 50

    def apply(self, text):
        return text.upper()


class Title(Plugin):
    name = "title"
    priority = 60

    def apply(self, text):
        return " ".join(word.capitalize() for word in text.split(" "))
