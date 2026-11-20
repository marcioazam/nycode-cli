"""Hierarquia de exceções do relkit. Todo erro de domínio sai daqui."""


class RelkitError(Exception):
    """Base de todos os erros do pacote."""


class ParseError(RelkitError, ValueError):
    """Texto de entrada inválido (versão, spec, padrão, duração, dinheiro, taxa).

    A mensagem é sempre ``invalid <kind> <repr(text)>: <reason>``.
    """

    def __init__(self, kind: str, text: str, reason: str) -> None:
        super().__init__(f"invalid {kind} {text!r}: {reason}")
        self.kind = kind
        self.text = text
        self.reason = reason


class ConfigError(RelkitError):
    """Erro no manifesto. ``line`` começa em 1; 0 = erro sem linha (consulta)."""

    def __init__(self, line: int, reason: str) -> None:
        super().__init__(f"line {line}: {reason}")
        self.line = line
        self.reason = reason


class ReportError(RelkitError):
    """Relatório impossível de montar com as entradas dadas."""
