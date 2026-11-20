"""Contas do razão."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Account:
    code: str
    name: str
    currency: str = "EUR"
