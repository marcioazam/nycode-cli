"""Contadores atualizados a cada execução de pipeline."""

from docflow.plugin import Plugin


class WordCount(Plugin):
    name = "wordcount"
    kind = "observer"
    priority = 100

    def setup(self):
        self.last = 0
        self.total = 0
        self.registry.add_hook("after_run", self._on_after, owner=self.plugin_name)

    def _on_after(self, text):
        self.last = len(text.split())
        self.total += self.last
        return self.last


class CharCount(Plugin):
    name = "charcount"
    kind = "observer"
    priority = 100

    def setup(self):
        self.last = 0
        self.registry.add_hook("after_run", self._on_after, owner=self.plugin_name)

    def _on_after(self, text):
        self.last = len(text)
        return self.last
