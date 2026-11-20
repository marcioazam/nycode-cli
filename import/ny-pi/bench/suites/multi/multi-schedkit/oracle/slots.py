def free_slots(
    busy: list[tuple[int, int]], day_start: int, day_end: int
) -> list[tuple[int, int]]:
    if day_start >= day_end:
        raise ValueError("window")
    if any(s > e for s, e in busy):
        raise ValueError("busy")
    out: list[tuple[int, int]] = []
    cur = day_start
    for s, e in sorted(busy):
        if e <= cur or s == e:
            continue
        if s >= day_end:
            break
        if s > cur:
            out.append((cur, s))
        cur = max(cur, e)
    if cur < day_end:
        out.append((cur, day_end))
    return out
