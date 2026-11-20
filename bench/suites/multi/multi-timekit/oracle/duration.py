import re

_UNITS = {"d": 86400, "h": 3600, "m": 60, "s": 1}


def parse_duration(s: str) -> int:
    t = "".join(s.split()).lower()
    if not re.fullmatch(r"(\d+[dhms])+", t):
        raise ValueError(s)
    units = re.findall(r"[dhms]", t)
    if len(set(units)) != len(units):
        raise ValueError(s)
    return sum(int(n) * _UNITS[u] for n, u in re.findall(r"(\d+)([dhms])", t))
