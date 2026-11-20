"""Durações em milissegundos: ``1h30m``, ``1.5s``, ``250ms``."""

import re
from fractions import Fraction

from relkit.errors import ParseError
from relkit.util.numbers import div_round_half_even

_UNITS = (("d", 86_400_000), ("h", 3_600_000), ("m", 60_000), ("s", 1000), ("ms", 1))
_PART = re.compile(r"(\d+)(?:\.(\d+))?([a-zA-Z]+)")


def _fail(text, reason):
    raise ParseError("duration", text, reason)


def parse_duration(text: str) -> int:
    body = text.strip()
    if not body:
        _fail(text, "empty")
    names = [name for name, _ in _UNITS]
    scale = dict(_UNITS)
    total = Fraction(0)
    last = -1
    pos = 0
    while pos < len(body):
        match = _PART.match(body, pos)
        if not match:
            _fail(text, "bad syntax")
        whole, frac, unit = match.groups()
        if unit not in scale:
            _fail(text, "unknown unit")
        index = names.index(unit)
        if index <= last:
            _fail(text, "units out of order")
        last = index
        frac = frac or ""
        total += Fraction(int(whole + frac) * scale[unit], 10 ** len(frac))
        pos = match.end()
        while pos < len(body) and body[pos].isspace():
            pos += 1
    return div_round_half_even(total.numerator, total.denominator)


def format_duration(ms: int) -> str:
    if isinstance(ms, bool) or not isinstance(ms, int) or ms < 0:
        raise ValueError("ms must be a non-negative int")
    if ms == 0:
        return "0ms"
    parts = []
    for name, size in _UNITS:
        count, ms = divmod(ms, size)
        if count:
            parts.append(f"{count}{name}")
    return " ".join(parts)
