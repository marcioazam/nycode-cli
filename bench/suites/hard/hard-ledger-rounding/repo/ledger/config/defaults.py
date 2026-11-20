"""Valores padrão; os modos de arredondamento são nomes (ver docs/SPEC.md, regra 4)."""

from decimal import Decimal

REPORT_CURRENCY = "EUR"
FEE_RATE = Decimal("0.0125")

TAX_MODE = "half_up"
FEE_MODE = "half-up"
FX_MODE = "HALF_UP"
INTEREST_MODE = "half_even"
ALLOCATION_MODE = "down"
