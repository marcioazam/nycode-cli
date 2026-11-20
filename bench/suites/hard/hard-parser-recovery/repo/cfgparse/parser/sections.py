"""Cabeçalhos de seção e atribuições."""

from typing import Any

from cfgparse.lexer.tokens import Token
from cfgparse.parser.diagnostics import Fail
from cfgparse.parser.values import parse_value


def parse_header(toks: list[Token]) -> tuple[str, ...]:
    if len(toks) < 2 or toks[1].kind != "IDENT":
        pos = toks[1].pos if len(toks) > 1 else toks[0].pos
        code = (
            toks[1].value[0] if len(toks) > 1 and toks[1].kind == "BAD" else "E_HEADER"
        )
        raise Fail(pos, code, "nome de seção inválido")
    if len(toks) < 3 or toks[2].kind != "RBRACK":
        pos = toks[2].pos if len(toks) > 2 else toks[0].pos
        raise Fail(pos, "E_HEADER", "esperado ']'")
    if len(toks) > 3:
        raise Fail(toks[3].pos, "E_HEADER", "texto após o cabeçalho")
    return tuple(toks[1].value.split("."))


def parse_assignment(toks: list[Token]) -> tuple[str, Any, int]:
    first = toks[0]
    if first.kind == "BAD":
        raise Fail(first.pos, first.value[0], first.value[1])
    if first.kind != "IDENT" or "." in first.value:
        raise Fail(first.pos, "E_SYNTAX", "esperada uma chave")
    if len(toks) < 2 or toks[1].kind != "EQ":
        raise Fail(
            toks[1].pos if len(toks) > 1 else first.pos, "E_SYNTAX", "esperado '='"
        )
    value, end = parse_value(toks, 2)
    if end < len(toks):
        raise Fail(toks[end].pos, "E_SYNTAX", "texto após o valor")
    return first.value, value, first.pos
