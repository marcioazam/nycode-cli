"""Execução de uma sequência de estágios."""

from docflow.core.document import Document
from docflow.errors import PipelineError
from docflow.registry import default_registry


class Pipeline:
    """Aplica os plugins "transform" na ordem dada."""

    def __init__(self, stages, registry=None):
        self.stages = list(stages)
        self.registry = default_registry() if registry is None else registry

    def run(self, text):
        """Carrega cada estágio e aplica em sequência."""
        for name in self.stages:
            if self.registry.get(name).kind != "transform":
                raise PipelineError(f"not a transform: {name}")
            text = self.registry.load(name).apply(text)
        return text

    def run_document(self, document):
        """Como run, mas para um Document (metadados preservados)."""
        if not isinstance(document, Document):
            raise TypeError("document must be a Document")
        return document.with_text(self.run(document.text))
