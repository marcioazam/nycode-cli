"""Tabela de texto (SPEC 13)."""

from __future__ import annotations

from collections.abc import Sequence


def render_table(headers: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    """Colunas separadas por dois espaços; inteiros à direita, texto à esquerda."""
    cells = [[str(v) for v in row] for row in rows]
    numeric = [
        bool(rows) and all(isinstance(row[i], int) for row in rows)
        for i in range(len(headers))
    ]
    widths = [
        max([len(h)] + [len(row[i]) for row in cells]) for i, h in enumerate(headers)
    ]

    def fmt(values: Sequence[str]) -> str:
        parts = [
            v.rjust(widths[i]) if numeric[i] else v.ljust(widths[i])
            for i, v in enumerate(values)
        ]
        return "  ".join(parts).rstrip()

    lines = [fmt(headers), "  ".join("-" * w for w in widths)]
    lines += [fmt(row) for row in cells]
    return "\n".join(lines)
