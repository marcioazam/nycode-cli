"""Tokens."""

from typing import Any, NamedTuple


class Token(NamedTuple):
    kind: str  # LBRACK RBRACK EQ COMMA IDENT STRING INT FLOAT BAD
    value: Any
    pos: int  # deslocamento em `Logical.text`
