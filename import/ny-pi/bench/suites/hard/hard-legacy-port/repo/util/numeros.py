"""Aritmética inteira usada no cálculo de valores."""


def pct_meio_acima(valor: int, pct: int) -> int:
    """`valor * pct / 100` com meio centavo arredondando para cima (valor >= 0)."""
    if valor < 0 or pct < 0:
        raise ValueError("valor e pct devem ser >= 0")
    return (valor * pct + 50) // 100


def teto_div(a: int, b: int) -> int:
    """Divisão inteira arredondada para cima (a >= 0, b > 0)."""
    if a < 0 or b <= 0:
        raise ValueError("a >= 0 e b > 0")
    return -(-a // b)


def teto_multiplo(valor: int, multiplo: int) -> int:
    """Menor múltiplo de `multiplo` que é >= `valor`."""
    return teto_div(valor, multiplo) * multiplo
