"""Tipos de valor compartilhados pelos módulos."""

from dataclasses import dataclass

# Moeda -> número de casas decimais da unidade mínima.
CURRENCIES = {"USD": 2, "EUR": 2, "BRL": 2, "JPY": 0, "KWD": 3}


@dataclass(frozen=True)
class Version:
    """Versão semântica. ``pre`` mistura int e str; ``build`` só tem str."""

    major: int
    minor: int
    patch: int
    pre: tuple = ()
    build: tuple = ()


@dataclass(frozen=True)
class Money:
    """Quantia em unidades mínimas (centavos para USD, ienes para JPY)."""

    units: int
    currency: str

    def __post_init__(self) -> None:
        if isinstance(self.units, bool) or not isinstance(self.units, int):
            raise TypeError("units must be int")
        if self.currency not in CURRENCIES:
            raise ValueError(f"unknown currency {self.currency!r}")

    @property
    def decimals(self) -> int:
        return CURRENCIES[self.currency]
