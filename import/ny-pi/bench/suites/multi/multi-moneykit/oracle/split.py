def allocate(total_cents: int, weights: list[int]) -> list[int]:
    if not weights or any(w < 0 for w in weights) or sum(weights) == 0:
        raise ValueError("weights")
    sign = -1 if total_cents < 0 else 1
    t, s = abs(total_cents), sum(weights)
    base = [t * w // s for w in weights]
    rem = t - sum(base)
    order = sorted(range(len(weights)), key=lambda i: (-(t * weights[i] % s), i))
    for i in order[:rem]:
        base[i] += 1
    return [sign * b for b in base]


def split_evenly(total_cents: int, parts: int) -> list[int]:
    if parts < 1:
        raise ValueError(parts)
    return allocate(total_cents, [1] * parts)
