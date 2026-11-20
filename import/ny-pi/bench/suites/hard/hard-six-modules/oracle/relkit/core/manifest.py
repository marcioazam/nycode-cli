"""Manifesto INI com aspas, continuação de linha e interpolação ``${secao.chave}``."""

import re

from relkit.errors import ConfigError
from relkit.util.scan import find_unquoted

_SECTION = re.compile(r"\[([A-Za-z][A-Za-z0-9_-]*)\]\Z")
_KEY = re.compile(r"[A-Za-z][A-Za-z0-9_.-]*\Z")
_ESCAPES = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
_MISSING = object()


class Manifest:
    def __init__(self, sections, lines=None):
        self.sections = sections
        self.lines = lines or {}

    def get(self, path: str, default=_MISSING) -> str:
        section, _, key = path.partition(".")
        try:
            return self.sections[section][key]
        except KeyError:
            if default is _MISSING:
                raise ConfigError(0, f"missing {path!r}") from None
            return default


def _value(text, number):
    """Valor de uma linha ``chave = texto``: (texto, entre_aspas)."""
    if not text.startswith('"'):
        match = re.search(r"\s#", text)
        return (text[: match.start()] if match else text).strip(), False
    out, i = [], 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            if i + 1 >= len(text):
                break
            escaped = text[i + 1]
            if escaped not in _ESCAPES:
                raise ConfigError(number, f"bad escape '\\{escaped}'")
            out.append(_ESCAPES[escaped])
            i += 2
            continue
        if ch == '"':
            rest = text[i + 1 :]
            if rest.strip() and not (rest[0] in " \t" and rest.strip().startswith("#")):
                raise ConfigError(number, "text after closing quote")
            return "".join(out), True
        out.append(ch)
        i += 1
    raise ConfigError(number, "unterminated string")


def _interpolate(sections, lines, done, section, key, stack):
    text = sections[section][key]
    if (section, key) in done or "$" not in text:
        return text
    number = lines[(section, key)]
    out, i = [], 0
    while i < len(text):
        if text.startswith("$$", i):
            out.append("$")
            i += 2
        elif text.startswith("${", i):
            end = text.find("}", i)
            if end == -1:
                raise ConfigError(number, "unterminated reference")
            ref = text[i + 2 : end]
            target_section, _, target_key = ref.partition(".")
            if target_key not in sections.get(target_section, {}):
                raise ConfigError(number, f"unknown reference {ref!r}")
            if (target_section, target_key) in stack:
                raise ConfigError(number, f"cycle at {ref!r}")
            out.append(
                _interpolate(
                    sections,
                    lines,
                    done,
                    target_section,
                    target_key,
                    stack + [(target_section, target_key)],
                )
            )
            i = end + 1
        else:
            out.append(text[i])
            i += 1
    result = "".join(out)
    sections[section][key] = result
    done.add((section, key))
    return result


def parse_manifest(text: str) -> Manifest:
    sections, lines, quoted = {}, {}, {}
    current = last = None
    for number, raw in enumerate(text.split("\n"), 1):
        line = raw.rstrip("\r")
        stripped = line.strip()
        if not stripped:
            last = None
            continue
        if stripped[0] in "#;":
            continue
        if line[0] in " \t":
            if last is None:
                raise ConfigError(number, "unexpected continuation")
            if quoted[last]:
                raise ConfigError(number, "continuation of quoted value")
            piece, _ = _value(stripped, number)
            sections[last[0]][last[1]] += " " + piece
            continue
        if stripped[0] == "[":
            match = _SECTION.match(stripped)
            if not match:
                raise ConfigError(number, "bad section header")
            name = match.group(1)
            if name in sections:
                raise ConfigError(number, f"duplicate section {name!r}")
            sections[name] = {}
            current, last = name, None
            continue
        index = find_unquoted(stripped, "=")
        if index == -1:
            raise ConfigError(number, "expected 'key = value'")
        key = stripped[:index].strip()
        if not key:
            raise ConfigError(number, "empty key")
        if not _KEY.match(key):
            raise ConfigError(number, f"bad key {key!r}")
        if current is None:
            raise ConfigError(number, "key outside section")
        if key in sections[current]:
            raise ConfigError(number, f"duplicate key {key!r}")
        value, is_quoted = _value(stripped[index + 1 :].strip(), number)
        sections[current][key] = value
        lines[(current, key)] = number
        quoted[(current, key)] = is_quoted
        last = (current, key)
    done = set()
    for section in list(sections):
        for key in list(sections[section]):
            _interpolate(sections, lines, done, section, key, [(section, key)])
    return Manifest(sections, lines)
