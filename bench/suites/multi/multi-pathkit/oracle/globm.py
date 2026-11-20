import re


def _seg(p: str, s: str) -> bool:
    rx = "".join(
        "[^/]*" if c == "*" else "[^/]" if c == "?" else re.escape(c) for c in p
    )
    return re.fullmatch(rx, s) is not None


def _m(ps: list[str], ss: list[str]) -> bool:
    if not ps:
        return not ss
    if ps[0] == "**":
        return any(_m(ps[1:], ss[i:]) for i in range(len(ss) + 1))
    return bool(ss) and _seg(ps[0], ss[0]) and _m(ps[1:], ss[1:])


def glob_match(pattern: str, path: str) -> bool:
    return _m(pattern.split("/"), path.split("/"))
