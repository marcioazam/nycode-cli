"""Une linhas físicas em linhas lógicas (continuação por `\\` e listas multilinha)."""

from cfgparse.reader.logical import Logical


class LineScanner:
    """Acompanha strings, comentários e colchetes enquanto consome linhas físicas."""

    def __init__(self) -> None:
        self.depth = 0  # colchetes abertos - fechados, fora de strings e comentários
        self.in_string = False

    def feed(self, line: str) -> bool:
        """Consome uma linha física; devolve se o código dela (sem o comentário) termina em `\\`."""
        self.in_string = False  # uma string nunca passa de uma linha física (regra 9)
        i, code_end = 0, len(line)
        while i < len(line):
            c = line[i]
            if self.in_string:
                if c == "\\":
                    i += 2
                    continue
                if c == '"':
                    self.in_string = False
            elif c == '"':
                self.in_string = True
            elif c == "#":
                code_end = i
                break
            elif c == "[":
                self.depth += 1
            elif c == "]":
                self.depth -= 1
            i += 1
        return line[:code_end].endswith("\\")


def join_lines(lines: list[str]) -> list[Logical]:
    out: list[Logical] = []
    i = 0
    while i < len(lines):
        start = i
        scanner = LineScanner()  # estado novo a cada instrução (regras 5 e 14)
        cont = scanner.feed(lines[i])
        is_header = lines[i].lstrip(" \t").startswith("[")
        while (cont or (scanner.depth > 0 and not is_header)) and i + 1 < len(lines):
            i += 1
            cont = scanner.feed(lines[i])
        out.append(Logical.build(start + 1, lines[start : i + 1]))
        i += 1
    return out
