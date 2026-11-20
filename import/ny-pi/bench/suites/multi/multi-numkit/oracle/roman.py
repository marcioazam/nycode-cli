_T = [
    (1000, "M"),
    (900, "CM"),
    (500, "D"),
    (400, "CD"),
    (100, "C"),
    (90, "XC"),
    (50, "L"),
    (40, "XL"),
    (10, "X"),
    (9, "IX"),
    (5, "V"),
    (4, "IV"),
    (1, "I"),
]


def to_roman(n: int) -> str:
    if not 1 <= n <= 3999:
        raise ValueError(n)
    out = ""
    for v, sym in _T:
        while n >= v:
            out += sym
            n -= v
    return out


def from_roman(s: str) -> int:
    i, total = 0, 0
    for v, sym in _T:
        while s.startswith(sym, i):
            total += v
            i += len(sym)
    if i != len(s) or not s or to_roman(total) != s:
        raise ValueError(s)
    return total
