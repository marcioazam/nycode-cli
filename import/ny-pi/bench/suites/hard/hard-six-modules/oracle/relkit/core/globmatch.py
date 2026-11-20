"""Padrões glob para caminhos: ``*``, ``?``, ``**``, classes, chaves e negação."""

import re

from relkit.errors import ParseError
from relkit.util.paths import segments


def _fail(pattern, reason):
    raise ParseError("pattern", pattern, reason)


def _class_end(text, start):
    """Índice do ``]`` que fecha a classe aberta em ``start``; -1 se não fecha."""
    i = start + 1
    if i < len(text) and text[i] == "!":
        i += 1
    if i < len(text) and text[i] == "]":
        i += 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == "]":
            return i
        i += 1
    return -1


def _expand(pattern, whole):
    """Expande a primeira chave de ``pattern`` (sem aninhamento) em alternativas."""
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "[":
            end = _class_end(pattern, i)
            if end == -1:
                _fail(whole, "unclosed class")
            i = end + 1
            continue
        if ch == "{":
            j = i + 1
            options, current = [], []
            while True:
                if j >= len(pattern):
                    _fail(whole, "unclosed brace")
                c = pattern[j]
                if c == "\\":
                    current.append(pattern[j : j + 2])
                    j += 2
                    continue
                if c == "{":
                    _fail(whole, "nested braces")
                if c == "}":
                    options.append("".join(current))
                    break
                if c == ",":
                    options.append("".join(current))
                    current = []
                else:
                    current.append(c)
                j += 1
            result = []
            for option in options:
                result.extend(_expand(pattern[:i] + option + pattern[j + 1 :], whole))
            return result
        i += 1
    return [pattern]


def _segment_regex(seg, whole):
    out, i = [], 0
    while i < len(seg):
        ch = seg[i]
        if ch == "\\":
            if i + 1 >= len(seg):
                _fail(whole, "dangling escape")
            out.append(re.escape(seg[i + 1]))
            i += 2
        elif ch == "*":
            out.append("[^/]*")
            i += 1
        elif ch == "?":
            out.append("[^/]")
            i += 1
        elif ch == "[":
            end = _class_end(seg, i)
            if end == -1:
                _fail(whole, "unclosed class")
            body = seg[i + 1 : end]
            negate = body.startswith("!")
            body = body[1:] if negate else body
            body = re.sub(r"\\(.)", lambda m: re.escape(m.group(1)), body)
            body = body.replace("[", r"\[")
            out.append("[" + ("^" if negate else "") + body + "]")
            i = end + 1
        else:
            out.append(re.escape(ch))
            i += 1
    literal_dot = seg.startswith((".", "\\."))
    try:
        return re.compile(("" if literal_dot else "(?!\\.)") + "".join(out))
    except re.error:
        _fail(whole, "bad class")


def _compile(pattern):
    """Lista de alternativas; cada uma é uma lista de segmentos (``None`` = ``**``)."""
    if not pattern:
        _fail(pattern, "empty")
    result = []
    for option in _expand(pattern, pattern):
        parts = [p for p in option.split("/") if p not in ("", ".")]
        if not parts:
            _fail(pattern, "empty")
        result.append(
            [None if p == "**" else _segment_regex(p, pattern) for p in parts]
        )
    return result


def _match(parts, names):
    if not parts:
        return not names
    head = parts[0]
    if head is None:
        if _match(parts[1:], names):
            return True
        return bool(names) and not names[0].startswith(".") and _match(parts, names[1:])
    return (
        bool(names)
        and head.fullmatch(names[0]) is not None
        and _match(parts[1:], names[1:])
    )


def glob_match(pattern: str, path: str) -> bool:
    names = segments(path)
    return any(_match(parts, names) for parts in _compile(pattern))


def filter_paths(patterns, paths) -> list:
    compiled = []
    for pattern in patterns:
        negated = pattern.startswith("!")
        compiled.append((negated, _compile(pattern[1:] if negated else pattern)))
    kept = []
    for path in paths:
        names = segments(path)
        included = False
        for negated, alternatives in compiled:
            if any(_match(parts, names) for parts in alternatives):
                included = not negated
        if included:
            kept.append(path)
    return kept
