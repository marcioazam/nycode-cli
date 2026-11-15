"""Contadores atualizados a cada execução de pipeline."""

from docflow import hooks
from docflow.plugin import Plugin
from docflow.registry import register


@register
class WordCount(Plugin):
    name = "wordcount"
    kind = "observer"
    priority = 100

    def setup(self):
        self.last = 0
        self.total = 0
        hooks.add_hook("after_run", self._on_after, owner=self.name)

    def _on_after(self, text):
        self.last = len(text.split())
        self.total += self.last
        return self.last


@register
class CharCount(Plugin):
    name = "charcount"
    kind = "observer"
    priority = 100

    def setup(self):
        self.last = 0
        hooks.add_hook("after_run", self._on_after, owner=self.name)

    def _on_after(self, text):
        self.last = len(text)
        return self.last
