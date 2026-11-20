def line_diff(a: list[str], b: list[str]) -> list[tuple[str, str]]:
    n, m = len(a), len(b)
    t = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            t[i][j] = (
                t[i + 1][j + 1] + 1 if a[i] == b[j] else max(t[i + 1][j], t[i][j + 1])
            )
    out: list[tuple[str, str]] = []
    i = j = 0
    while i < n and j < m:
        if a[i] == b[j]:
            out.append((" ", a[i]))
            i += 1
            j += 1
        elif t[i + 1][j] >= t[i][j + 1]:
            out.append(("-", a[i]))
            i += 1
        else:
            out.append(("+", b[j]))
            j += 1
    out += [("-", x) for x in a[i:]]
    out += [("+", x) for x in b[j:]]
    return out
