"""Registro de auditoria: depende do contador de palavras."""

from docflow.plugin import Plugin


class Audit(Plugin):
    name = "audit"
    kind = "observer"
    priority = 200
    requires = ("wordcount",)

    def setup(self):
        self.log = []
        self.registry.add_hook("before_run", self._on_before, owner=self.plugin_name)
        self.registry.add_hook("after_run", self._on_after, owner=self.plugin_name)

    def _on_before(self, text):
        self.log.append("start")

    def _on_after(self, text):
        counter = self.registry.load("wordcount")
        self.log.append("%d words" % counter.last)  # noqa: UP031
