def parse(text: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    cur: dict[str, str] | None = None
    for no, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line[0] in "#;":
            continue
        if line[0] == "[":
            if not line.endswith("]") or len(line) < 3 or "[" in line[1:-1]:
                raise ValueError(f"line {no}: bad section")
            cur = out.setdefault(line[1:-1].strip(), {})
            continue
        key, sep, val = line.partition("=")
        if not sep or not key.strip():
            raise ValueError(f"line {no}: expected key = value")
        if cur is None:
            raise ValueError(f"line {no}: key outside section")
        cur[key.strip()] = val.strip()
    return out
