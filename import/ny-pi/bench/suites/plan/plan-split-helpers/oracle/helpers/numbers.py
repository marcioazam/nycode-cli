def clamp(x, lo, hi):
    if lo > hi:
        raise ValueError("lo > hi")
    return max(lo, min(hi, x))


def mean(xs):
    xs = list(xs)
    if not xs:
        raise ValueError("empty")
    return sum(xs) / len(xs)
