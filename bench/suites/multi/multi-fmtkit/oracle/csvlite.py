def parse(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    row: list[str] = []
    f: list[str] = []
    quoted = False
    in_q = False
    dirty = False
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if in_q:
            if c == '"':
                if text[i + 1 : i + 2] == '"':
                    f.append('"')
                    i += 1
                else:
                    in_q = False
            else:
                f.append(c)
        elif c == '"' and not f and not quoted:
            in_q = quoted = dirty = True
        elif c == ",":
            row.append("".join(f))
            f, quoted, dirty = [], False, True
        elif c == "\r" and text[i + 1 : i + 2] == "\n":
            pass
        elif c == "\n":
            if dirty:
                row.append("".join(f))
                rows.append(row)
            row, f, quoted, dirty = [], [], False, False
        else:
            f.append(c)
            dirty = True
        i += 1
    if in_q:
        raise ValueError("unterminated quote")
    if dirty:
        row.append("".join(f))
        rows.append(row)
    return rows
