import re


def to_snake(s: str) -> str:
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", "_", s)
    return re.sub(r"[-\s_]+", "_", s).lower()


def to_camel(s: str) -> str:
    parts = [p for p in re.split(r"[_\-\s]+", s) if p]
    if not parts:
        return ""
    return parts[0].lower() + "".join(p.capitalize() for p in parts[1:])
