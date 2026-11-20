"""Pequenos helpers de texto."""


def so_digitos(texto: str) -> bool:
    """True se o texto é não vazio e só tem dígitos ASCII."""
    return texto != "" and all(ch in "0123456789" for ch in texto)


def agrupa_milhar(inteiro: int, sep: str = ".") -> str:
    """1234567 -> '1.234.567' (inteiro >= 0)."""
    if inteiro < 0:
        raise ValueError("inteiro deve ser >= 0")
    return f"{inteiro:,}".replace(",", sep)


def plural(n: int, singular: str, plural_: str) -> str:
    return singular if n == 1 else plural_
