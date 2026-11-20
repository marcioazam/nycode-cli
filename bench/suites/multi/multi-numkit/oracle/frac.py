import math
import re


def simplify(num: int, den: int) -> tuple[int, int]:
    if den == 0:
        raise ZeroDivisionError("den")
    g = math.gcd(num, den)
    num, den = num // g, den // g
    if den < 0:
        num, den = -num, -den
    return num, den


def parse_ratio(s: str) -> tuple[int, int]:
    m = re.fullmatch(r"\s*(-?\d+)\s*[:/]\s*(-?\d+)\s*", s)
    if not m or int(m.group(2)) == 0:
        raise ValueError(s)
    return simplify(int(m.group(1)), int(m.group(2)))
