_D = "0123456789abcdefghijklmnopqrstuvwxyz"


def to_base(n: int, base: int) -> str:
    if not 2 <= base <= 36:
        raise ValueError(base)
    if n == 0:
        return "0"
    sign, n = ("-", -n) if n < 0 else ("", n)
    out = []
    while n:
        n, r = divmod(n, base)
        out.append(_D[r])
    return sign + "".join(reversed(out))


def from_base(s: str, base: int) -> int:
    if not 2 <= base <= 36:
        raise ValueError(base)
    neg = s.startswith("-")
    body = s[1:] if neg else s
    if not body:
        raise ValueError(s)
    n = 0
    for ch in body.lower():
        d = _D.find(ch)
        if d < 0 or d >= base:
            raise ValueError(s)
        n = n * base + d
    return -n if neg else n
