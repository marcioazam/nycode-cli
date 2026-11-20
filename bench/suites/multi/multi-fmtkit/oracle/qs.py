from urllib.parse import quote_plus, unquote_plus


def parse_qs(s: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for pair in s.removeprefix("?").split("&"):
        if not pair:
            continue
        k, _, v = pair.partition("=")
        out.setdefault(unquote_plus(k), []).append(unquote_plus(v))
    return out


def encode(d: dict[str, str | list[str]]) -> str:
    pairs = []
    for k, v in d.items():
        for item in [v] if isinstance(v, str) else v:
            pairs.append(f"{quote_plus(k)}={quote_plus(item)}")
    return "&".join(pairs)
