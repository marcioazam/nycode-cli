"""Números inteiros e decimais."""

import re

from cfgparse.lexer.tokens import Token

_NUM = re.compile(r"[+-]?\d+(?:\.\d+)?")


def read_number(text: str, start: int) -> tuple[Token | None, int]:
    m = _NUM.match(text, start)
    if m is None:
        return None, start
    raw = m.group()
    kind, value = ("FLOAT", float(raw)) if "." in raw else ("INT", int(raw))
    return Token(kind, value, start), m.end()
