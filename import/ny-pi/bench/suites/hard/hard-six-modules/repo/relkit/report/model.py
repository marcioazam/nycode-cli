"""Entradas do relatório."""

import json
from dataclasses import dataclass

from relkit.errors import ReportError


@dataclass(frozen=True)
class FileEntry:
    """Arquivo candidato a artefato: caminho, tamanho em bytes e duração do build."""

    path: str
    size: int
    build: str


def load_entries(json_text: str) -> list:
    """Lê uma lista JSON de objetos {"path", "size", "build"}."""
    try:
        data = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ReportError(f"bad files json: {exc.msg}") from None
    if not isinstance(data, list):
        raise ReportError("files json must be a list")
    entries = []
    for index, item in enumerate(data):
        if not isinstance(item, dict) or set(item) != {"path", "size", "build"}:
            raise ReportError(f"bad file entry {index}")
        size = item["size"]
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise ReportError(f"bad file entry {index}")
        if not isinstance(item["path"], str) or not isinstance(item["build"], str):
            raise ReportError(f"bad file entry {index}")
        entries.append(FileEntry(item["path"], size, item["build"]))
    return entries
