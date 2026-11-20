import re

_RE = re.compile(
    r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?"
)


def _parse(s: str) -> tuple[tuple[int, ...], list[str]]:
    m = _RE.fullmatch(s)
    if not m:
        raise ValueError(s)
    pre = m.group(4).split(".") if m.group(4) else []
    for p in pre:
        if p == "" or (p.isdigit() and len(p) > 1 and p[0] == "0"):
            raise ValueError(s)
    return tuple(int(m.group(i)) for i in (1, 2, 3)), pre


def _key(pre: list[str]) -> list[tuple[int, int, str]]:
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre]


def compare(a: str, b: str) -> int:
    (va, pa), (vb, pb) = _parse(a), _parse(b)
    if va != vb:
        return -1 if va < vb else 1
    if not pa and not pb:
        return 0
    if not pa:
        return 1
    if not pb:
        return -1
    ka, kb = _key(pa), _key(pb)
    return (ka > kb) - (ka < kb)
