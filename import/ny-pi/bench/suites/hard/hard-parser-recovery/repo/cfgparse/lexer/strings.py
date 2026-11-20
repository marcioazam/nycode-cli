"""Strings entre aspas, numa única linha física."""

from cfgparse.lexer.tokens import Token

_ESCAPES = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}


def read_string(text: str, start: int) -> tuple[Token, int]:
    """Lê a string que abre em `text[start]`; devolve (token, próximo índice)."""
    out: list[str] = []
    bad: Token | None = None
    i = start + 1
    while i < len(text) and text[i] != "\n":
        c = text[i]
        if c == '"':
            return (bad or Token("STRING", "".join(out), start)), i + 1
        if c == "\\":
            esc = text[i + 1 : i + 2]
            if esc in _ESCAPES:
                out.append(_ESCAPES[esc])
                i += 2
                continue
            bad = bad or Token("BAD", ("E_STRING", "escape inválido"), i)
        else:
            out.append(c)
        i += 1
    return (bad or Token("BAD", ("E_STRING", "string não terminada"), start)), i
