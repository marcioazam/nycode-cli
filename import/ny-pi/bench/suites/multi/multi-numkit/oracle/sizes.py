import re
from decimal import Decimal

_U = ["B", "KiB", "MiB", "GiB", "TiB"]
_M = {"": 1, "b": 1}
for _i, _u in enumerate(["k", "m", "g", "t"], 1):
    _M[_u + "ib"] = 1024**_i
    _M[_u + "b"] = 1000**_i


def human_bytes(n: int) -> str:
    if n < 0:
        raise ValueError(n)
    if n < 1024:
        return f"{n} B"
    v = float(n)
    for u in _U[1:]:
        v /= 1024
        if v < 1024 or u == "TiB":
            return f"{v:.1f} {u}"
    raise AssertionError


def parse_bytes(s: str) -> int:
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([A-Za-z]*)\s*", s)
    if not m or m.group(2).lower() not in _M:
        raise ValueError(s)
    return int(Decimal(m.group(1)) * _M[m.group(2).lower()])
