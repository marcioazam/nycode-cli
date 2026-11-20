def luhn_valid(s: str) -> bool:
    t = s.replace(" ", "").replace("-", "")
    if len(t) < 2 or not (t.isascii() and t.isdigit()):
        return False
    total = 0
    for i, ch in enumerate(reversed(t)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0
