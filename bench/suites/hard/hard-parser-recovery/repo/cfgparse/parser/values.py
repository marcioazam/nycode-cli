"""Valores: escalares e listas."""

from typing import Any

from cfgparse.lexer.tokens import Token
from cfgparse.parser.diagnostics import Fail

_BOOLS = {"true": True, "false": False}


def _bad(tok: Token) -> Fail:
    code, message = tok.value
    return Fail(tok.pos, code, message)


def parse_value(toks: list[Token], i: int) -> tuple[Any, int]:
    if i >= len(toks):
        raise Fail(toks[-1].pos if toks else 0, "E_SYNTAX", "valor ausente")
    tok = toks[i]
    if tok.kind == "BAD":
        raise _bad(tok)
    if tok.kind in ("STRING", "INT", "FLOAT"):
        return tok.value, i + 1
    if tok.kind == "IDENT" and tok.value in _BOOLS:
        return _BOOLS[tok.value], i + 1
    if tok.kind == "LBRACK":
        return _parse_list(toks, i)
    raise Fail(tok.pos, "E_SYNTAX", f"valor inesperado {tok.value!r}")


def _parse_list(toks: list[Token], i: int) -> tuple[list, int]:
    open_pos, items = toks[i].pos, []
    i += 1
    while True:
        if i >= len(toks):
            raise Fail(open_pos, "E_LIST", "lista não terminada")
        if toks[i].kind == "RBRACK":
            return items, i + 1
        value, i = parse_value(toks, i)
        items.append(value)
        if i >= len(toks):
            raise Fail(open_pos, "E_LIST", "lista não terminada")
        if toks[i].kind == "COMMA":
            i += 1
        elif toks[i].kind != "RBRACK":
            raise Fail(toks[i].pos, "E_SYNTAX", "esperado ',' ou ']'")
