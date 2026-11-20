"""Character-level CSV tokenizer.

Yields (starting line, fields) per record. Blank lines and comment lines
between records are skipped here, so callers only see real records.
"""

from typing import NamedTuple

from reportkit.errors import ReadError

SEPARATOR = ","
QUOTE = '"'
COMMENT = "#"
BOM = "\ufeff"
_BLANKS = " \t"


class Field(NamedTuple):
    value: str
    quoted: bool


def tokenize(text):
    text = text.removeprefix(BOM)
    pos, line, size = 0, 1, len(text)
    while pos < size:
        if _is_skippable(text, pos):
            pos = _line_end(text, pos) + 1
            line += 1
            continue
        start = line
        fields, pos, line = _read_record(text, pos, line)
        yield start, fields


def _line_end(text, pos):
    end = text.find("\n", pos)
    return len(text) if end == -1 else end


def _is_skippable(text, pos):
    content = text[pos : _line_end(text, pos)].strip(_BLANKS + "\r")
    return content == "" or content.startswith(COMMENT)


def _read_record(text, pos, line):
    start = line
    fields = []
    while True:
        field, pos, line = _read_field(text, pos, line, start)
        fields.append(field)
        if pos < len(text) and text[pos] == SEPARATOR:
            pos += 1
            continue
        # Either the "\n" that ends the record or the end of the input.
        return fields, pos + 1, line + 1


def _read_field(text, pos, line, start):
    size = len(text)
    if pos < size and text[pos] == QUOTE:
        return _read_quoted(text, pos + 1, line, start)
    end = pos
    while end < size and text[end] not in (SEPARATOR, "\n"):
        end += 1
    stop = end
    if end < size and text[end] == "\n" and stop > pos and text[stop - 1] == "\r":
        stop -= 1
    return Field(text[pos:stop].strip(_BLANKS), False), end, line


def _read_quoted(text, pos, line, start):
    size = len(text)
    parts = []
    while True:
        if pos >= size:
            raise ReadError(f"line {start}: unterminated quoted field")
        char = text[pos]
        if char == QUOTE:
            if text.startswith(QUOTE, pos + 1):
                parts.append(QUOTE)
                pos += 2
                continue
            pos += 1
            break
        if char == "\n":
            line += 1
        parts.append(char)
        pos += 1
    if text.startswith("\r\n", pos):
        pos += 1
    if pos < size and text[pos] not in (SEPARATOR, "\n"):
        raise ReadError(f"line {start}: unexpected character after closing quote")
    return Field("".join(parts), True), pos, line
