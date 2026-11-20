"""Varredura de texto que respeita aspas duplas e escapes com barra invertida."""


def find_unquoted(text: str, chars: str, start: int = 0) -> int:
    """Índice (>= start) do primeiro caractere de ``chars`` fora de aspas; -1 se não há.

    O estado de aspas é contado desde o início de ``text``. Dentro de aspas,
    ``\\x`` consome dois caracteres. Aspas não fechadas valem até o fim.
    """
    in_quote = False
    index = 0
    while index < len(text):
        ch = text[index]
        if in_quote:
            if ch == "\\":
                index += 2
                continue
            if ch == '"':
                in_quote = False
        elif ch == '"':
            in_quote = True
        elif index >= start and ch in chars:
            return index
        index += 1
    return -1


def split_unquoted(text: str, sep: str) -> list:
    """Divide em cada ``sep`` (um caractere) que esteja fora de aspas."""
    parts = []
    position = 0
    while True:
        index = find_unquoted(text, sep, position)
        if index == -1:
            parts.append(text[position:])
            return parts
        parts.append(text[position:index])
        position = index + 1
