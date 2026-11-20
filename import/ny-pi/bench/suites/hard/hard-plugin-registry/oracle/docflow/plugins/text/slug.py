"""Slug: reaproveita os plugins lower e collapse."""

from docflow.plugin import Plugin


class Slugify(Plugin):
    name = "slugify"
    priority = 65
    requires = ("lower", "collapse")

    def apply(self, text):
        text = self.registry.load("lower").apply(text)
        text = self.registry.load("collapse").apply(text)
        return text.replace(" ", "-")
