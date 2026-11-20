"""Documento processado por um pipeline."""


class Document:
    """Texto mais metadados livres."""

    def __init__(self, text, meta=None):
        self.text = text
        self.meta = dict(meta or {})

    def with_text(self, text):
        """Cópia com outro texto e os mesmos metadados."""
        return Document(text, self.meta)

    def __eq__(self, other):
        if not isinstance(other, Document):
            return NotImplemented
        return self.text == other.text and self.meta == other.meta

    def __repr__(self):
        return f"Document({self.text!r}, {self.meta!r})"
