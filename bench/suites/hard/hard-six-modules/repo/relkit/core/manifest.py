"""Manifesto INI. Regras em docs/SPEC.md, seção 3."""


class Manifest:
    """Resultado de ``parse_manifest``: ``sections`` e ``get``."""

    def __init__(self, sections, lines=None):
        self.sections = sections
        self.lines = lines or {}

    def get(self, path: str, default=None) -> str:
        raise NotImplementedError


def parse_manifest(text: str) -> Manifest:
    raise NotImplementedError
