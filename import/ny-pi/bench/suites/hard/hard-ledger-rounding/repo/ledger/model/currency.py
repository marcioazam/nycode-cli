"""Moedas e seus expoentes (casas decimais da unidade menor)."""

EXPONENTS = {"EUR": 2, "USD": 2, "BRL": 2, "JPY": 0, "KWD": 3}


def exponent(code: str) -> int:
    try:
        return EXPONENTS[code]
    except KeyError:
        raise ValueError(f"moeda desconhecida: {code!r}") from None
