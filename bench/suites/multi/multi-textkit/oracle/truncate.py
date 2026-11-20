def truncate(s: str, width: int, ellipsis: str = "…") -> str:
    if width < len(ellipsis):
        raise ValueError("width too small")
    if len(s) <= width:
        return s
    return s[: width - len(ellipsis)] + ellipsis


def wrap(s: str, width: int) -> list[str]:
    if width < 1:
        raise ValueError("width")
    lines: list[str] = []
    cur = ""
    for w in s.split():
        while len(w) > width:
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(w[:width])
            w = w[width:]
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= width:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines
