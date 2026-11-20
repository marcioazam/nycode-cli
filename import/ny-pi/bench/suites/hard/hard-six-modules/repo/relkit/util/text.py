"""Largura de exibição em terminal e alinhamento."""

import unicodedata

ELLIPSIS = "…"


def display_width(text: str) -> int:
    """Colunas ocupadas: largos (CJK) valem 2, combinantes valem 0, o resto 1."""
    width = 0
    for ch in text:
        if unicodedata.combining(ch) or unicodedata.category(ch) in ("Mn", "Me", "Cf"):
            continue
        width += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return width


def pad(text: str, width: int, align: str = "l") -> str:
    """Completa com espaços até ``width`` colunas. align: "l", "r" ou "c".

    No centro, a coluna que sobra fica à direita. Texto mais largo sai intacto.
    """
    if align not in ("l", "r", "c"):
        raise ValueError(f"unknown align {align!r}")
    extra = max(0, width - display_width(text))
    if align == "l":
        return text + " " * extra
    if align == "r":
        return " " * extra + text
    left = extra // 2
    return " " * left + text + " " * (extra - left)


def truncate(text: str, width: int) -> str:
    """Corta para caber em ``width`` colunas, terminando em "…" (1 coluna)."""
    if width < 1:
        raise ValueError("width must be >= 1")
    if display_width(text) <= width:
        return text
    kept = []
    used = 0
    for ch in text:
        step = display_width(ch)
        if used + step > width - 1:
            break
        kept.append(ch)
        used += step
    return "".join(kept) + ELLIPSIS
