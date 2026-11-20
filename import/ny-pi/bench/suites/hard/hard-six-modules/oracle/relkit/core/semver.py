"""Versões semânticas: parse, comparação, bump e faixas."""

import re

from relkit.errors import ParseError
from relkit.types import Version
from relkit.util.numbers import parse_uint

_ID = re.compile(r"[0-9A-Za-z-]+\Z")


def _fail(text, reason):
    raise ParseError("version", text, reason)


def parse_version(text) -> Version:
    body = text.strip()
    body = body.removeprefix("v")
    build = ()
    if "+" in body:
        body, _, meta = body.partition("+")
        ids = meta.split(".")
        if not all(_ID.match(i) for i in ids):
            _fail(text, "bad build metadata")
        build = tuple(ids)
    pre = ()
    if "-" in body:
        body, _, tail = body.partition("-")
        ids = []
        for ident in tail.split("."):
            if not _ID.match(ident):
                _fail(text, "bad pre-release")
            if ident.isdigit():
                number = parse_uint(ident)
                if number is None:
                    _fail(text, "leading zero in pre-release")
                ids.append(number)
            else:
                ids.append(ident)
        pre = tuple(ids)
    parts = body.split(".")
    if len(parts) != 3:
        _fail(text, "expected MAJOR.MINOR.PATCH")
    numbers = [parse_uint(p) for p in parts]
    if None in numbers:
        _fail(text, "bad number")
    return Version(*numbers, pre=pre, build=build)


def _coerce(value) -> Version:
    return value if isinstance(value, Version) else parse_version(value)


def format_version(version: Version) -> str:
    text = f"{version.major}.{version.minor}.{version.patch}"
    if version.pre:
        text += "-" + ".".join(str(i) for i in version.pre)
    if version.build:
        text += "+" + ".".join(version.build)
    return text


def _cmp(a, b) -> int:
    return (a > b) - (a < b)


def _cmp_id(a, b) -> int:
    if isinstance(a, int) and isinstance(b, int):
        return _cmp(a, b)
    if isinstance(a, int):
        return -1
    if isinstance(b, int):
        return 1
    return _cmp(a, b)


def compare_versions(a, b) -> int:
    a, b = _coerce(a), _coerce(b)
    result = _cmp((a.major, a.minor, a.patch), (b.major, b.minor, b.patch))
    if result:
        return result
    if not a.pre or not b.pre:
        return _cmp(bool(a.pre), bool(b.pre)) * -1
    for x, y in zip(a.pre, b.pre):
        result = _cmp_id(x, y)
        if result:
            return result
    return _cmp(len(a.pre), len(b.pre))


def bump(version, part: str) -> Version:
    v = _coerce(version)
    if part == "major":
        return Version(v.major + 1, 0, 0)
    if part == "minor":
        return Version(v.major, v.minor + 1, 0)
    if part == "patch":
        return Version(v.major, v.minor, v.patch + 1)
    raise ValueError(f"unknown part {part!r}")


def _bad_spec(spec, reason):
    raise ParseError("spec", spec, reason)


def _clause(text, spec):
    """Devolve (predicados, versão_escrita); predicado = (operador, Version)."""
    clause = text.strip()
    if not clause:
        _bad_spec(spec, "empty clause")
    if clause == "*":
        return [], None
    for op in (">=", "<=", ">", "<", "=", "^", "~"):
        if clause.startswith(op):
            rest = clause[len(op) :]
            break
    else:
        op, rest = "=", clause
    try:
        ver = parse_version(rest)
    except ParseError:
        _bad_spec(spec, f"bad version in {clause!r}")
    if op == "^":
        if ver.major > 0:
            high = Version(ver.major + 1, 0, 0)
        elif ver.minor > 0:
            high = Version(0, ver.minor + 1, 0)
        else:
            high = Version(0, 0, ver.patch + 1)
        return [(">=", ver), ("<", high)], ver
    if op == "~":
        return [(">=", ver), ("<", Version(ver.major, ver.minor + 1, 0))], ver
    return [(op, ver)], ver


_TESTS = {
    ">=": lambda c: c >= 0,
    "<=": lambda c: c <= 0,
    ">": lambda c: c > 0,
    "<": lambda c: c < 0,
    "=": lambda c: c == 0,
}


def satisfies(version, spec: str) -> bool:
    v = _coerce(version)
    if not spec.strip():
        _bad_spec(spec, "empty spec")
    groups = [
        [_clause(c, spec) for c in group.split(",")] for group in spec.split("||")
    ]
    for group in groups:
        if not all(
            _TESTS[op](compare_versions(v, bound))
            for preds, _ in group
            for op, bound in preds
        ):
            continue
        triple = (v.major, v.minor, v.patch)
        if v.pre and not any(
            w and w.pre and (w.major, w.minor, w.patch) == triple for _, w in group
        ):
            continue
        return True
    return False


def max_satisfying(versions, spec: str):
    parsed = [(item, _coerce(item)) for item in versions]
    best = None
    for item, ver in parsed:
        if satisfies(ver, spec) and (
            best is None or compare_versions(ver, best[1]) > 0
        ):
            best = (item, ver)
    return None if best is None else best[0]
