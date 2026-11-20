"""Dinheiro em unidades mínimas. Regras em docs/SPEC.md, seção 6."""

from relkit.types import Money


def parse_money(text: str) -> Money:
    raise NotImplementedError


def format_money(money: Money) -> str:
    raise NotImplementedError


def split_money(money: Money, weights) -> list:
    raise NotImplementedError


def apply_rate(money: Money, rate: str, rounding: str = "half_even") -> Money:
    raise NotImplementedError


def convert(money: Money, to: str, rate: str, rounding: str = "half_even") -> Money:
    raise NotImplementedError


def add(a: Money, b: Money) -> Money:
    raise NotImplementedError


def sum_money(items, currency: str) -> Money:
    raise NotImplementedError
