def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def closest(word: str, candidates: list[str], max_dist: int = 2) -> str | None:
    best: str | None = None
    best_d = max_dist + 1
    for c in candidates:
        d = levenshtein(word, c)
        if d < best_d:
            best, best_d = c, d
    return best
