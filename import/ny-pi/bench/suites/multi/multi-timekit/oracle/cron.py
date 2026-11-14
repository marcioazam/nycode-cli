from datetime import datetime


def _field(tok: str, lo: int, hi: int) -> set[int]:
    out: set[int] = set()
    for part in tok.split(","):
        step = 1
        if "/" in part:
            part, st = part.split("/")
            step = int(st)
            if step < 1:
                raise ValueError(tok)
            if part != "*" and "-" not in part:
                raise ValueError(tok)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            x, y = part.split("-")
            a, b = int(x), int(y)
        else:
            a = b = int(part)
        if not (lo <= a <= b <= hi):
            raise ValueError(tok)
        out.update(range(a, b + 1, step))
    return out


def matches(expr: str, dt: datetime) -> bool:
    f = expr.split()
    if len(f) != 5:
        raise ValueError(expr)
    ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]
    sets = [_field(t, lo, hi) for t, (lo, hi) in zip(f, ranges)]
    dow = (dt.weekday() + 1) % 7
    vals = [dt.minute, dt.hour, dt.day, dt.month, dow]
    return all(v in s for v, s in zip(vals, sets))
