import re

_RE = re.compile(r"(-?)\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?")


def parse_money(s: str) -> int:
    m = _RE.fullmatch(s)
    if not m:
        raise ValueError(s)
    cents = int(m.group(2).replace(",", "")) * 100 + int(
        (m.group(3) or "").ljust(2, "0") or 0
    )
    return -cents if m.group(1) else cents


def format_money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(cents), 100)
    return f"{sign}${whole:,}.{frac:02d}"
