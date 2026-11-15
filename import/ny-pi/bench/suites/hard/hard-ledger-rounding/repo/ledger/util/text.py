"""Formatação de texto para o relatório."""

from decimal import Decimal


def format_amount(value: Decimal, exponent: int) -> str:
    """Formata um valor já arredondado com `exponent` casas."""
    return f"{value:.{exponent}f}"


def pad(text: str, width: int, right: bool = False) -> str:
    return text.rjust(width) if right else text.ljust(width)
