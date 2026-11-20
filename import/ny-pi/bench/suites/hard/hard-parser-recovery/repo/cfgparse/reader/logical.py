"""Linha lógica: uma ou mais linhas físicas unidas, com mapa de posições."""

from bisect import bisect_right
from dataclasses import dataclass


@dataclass(frozen=True)
class Logical:
    line: int  # número (base 1) da primeira linha física
    text: str  # linhas físicas unidas por "\n"
    starts: tuple[int, ...]  # deslocamento de cada linha física dentro de `text`

    @classmethod
    def build(cls, line: int, parts: list[str]) -> "Logical":
        starts, offset = [], 0
        for part in parts:
            starts.append(offset)
            offset += len(part) + 1
        return cls(line, "\n".join(parts), tuple(starts))

    def locate(self, pos: int) -> tuple[int, int]:
        """(linha, coluna) físicas, base 1, de um deslocamento em `text`."""
        idx = max(bisect_right(self.starts, pos) - 1, 0)
        return self.line + idx, pos - self.starts[idx] + 1
