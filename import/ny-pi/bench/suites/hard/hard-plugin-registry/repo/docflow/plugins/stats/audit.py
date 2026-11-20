"""Registro de auditoria: depende do contador de palavras."""

from docflow import hooks, registry
from docflow.plugin import Plugin
from docflow.registry import register


@register
class Audit(Plugin):
    name = "audit"
    kind = "observer"
    priority = 200
    requires = ("wordcount",)

    def setup(self):
        self.log = []
        hooks.add_hook("before_run", self._on_before, owner=self.name)
        hooks.add_hook("after_run", self._on_after, owner=self.name)

    def _on_before(self, text):
        self.log.append("start")

    def _on_after(self, text):
        counter = registry.load("wordcount")
        self.log.append("%d words" % counter.last)  # noqa: UP031
