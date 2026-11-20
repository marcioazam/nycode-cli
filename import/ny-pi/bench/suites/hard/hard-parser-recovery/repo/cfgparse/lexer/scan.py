"""Divide o texto de uma linha lógica em tokens."""

import re

from cfgparse.lexer.numbers import read_number
from cfgparse.lexer.strings import read_string
from cfgparse.lexer.tokens import Token

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*")
_PUNCT = {"[": "LBRACK", "]": "RBRACK", "=": "EQ", ",": "COMMA"}


def tokenize(text: str) -> list[Token]:
    toks: list[Token] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in " \t\n":
            i += 1
        elif c == "\\" and text[i + 1 : i + 2] == "\n":
            i += 2
        elif c == "#":
            while i < n and text[i] != "\n":
                i += 1
        elif c in _PUNCT:
            toks.append(Token(_PUNCT[c], c, i))
            i += 1
        elif c == '"':
            tok, i = read_string(text, i)
            toks.append(tok)
        elif c.isdigit() or c in "+-":
            tok, end = read_number(text, i)
            if tok is None:
                toks.append(Token("BAD", ("E_CHAR", f"caractere inesperado {c!r}"), i))
                i += 1
            else:
                toks.append(tok)
                i = end
        elif (m := _IDENT.match(text, i)) is not None:
            toks.append(Token("IDENT", m.group(), i))
            i = m.end()
        else:
            toks.append(Token("BAD", ("E_CHAR", f"caractere inesperado {c!r}"), i))
            i += 1
    return toks
