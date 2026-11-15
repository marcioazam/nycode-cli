"""Diagnósticos e a exceção interna de falha de uma linha."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Diagnostic:
    line: int
    col: int
    code: str
    message: str

    def __str__(self) -> str:
        return f"{self.line}:{self.col}: {self.code}: {self.message}"


class ParseError(Exception):
    def __init__(self, diagnostic: Diagnostic) -> None:
        super().__init__(str(diagnostic))
        self.diagnostic = diagnostic


class Fail(Exception):
    """Falha numa linha lógica: posição em `Logical.text`, código e mensagem."""

    def __init__(self, pos: int, code: str, message: str) -> None:
        super().__init__(message)
        self.pos, self.code, self.message = pos, code, message
