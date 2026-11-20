"""Slug: reaproveita os plugins lower e collapse."""

from docflow import registry
from docflow.plugin import Plugin
from docflow.registry import register


@register
class Slugify(Plugin):
    name = "slugify"
    priority = 65
    requires = ("lower", "collapse")

    def apply(self, text):
        text = registry.load("lower").apply(text)
        text = registry.load("collapse").apply(text)
        return text.replace(" ", "-")
