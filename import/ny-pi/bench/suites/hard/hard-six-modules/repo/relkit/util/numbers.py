"""Aritmética inteira exata (sem float)."""


def parse_uint(text: str):
    """Inteiro sem sinal em dígitos ASCII, sem zero à esquerda (exceto "0").

    Devolve o int, ou None quando o texto não segue a regra.
    """
    if not text or any(ch not in "0123456789" for ch in text):
        return None
    if len(text) > 1 and text[0] == "0":
        return None
    return int(text)


def div_round_half_even(num: int, den: int) -> int:
    """num/den arredondado ao inteiro mais próximo; empate vai para o par."""
    if den <= 0:
        raise ValueError("den must be positive")
    quotient, remainder = divmod(num, den)
    twice = 2 * remainder
    if twice > den or (twice == den and quotient % 2 == 1):
        quotient += 1
    return quotient


def div_round_half_up(num: int, den: int) -> int:
    """num/den arredondado ao mais próximo; empate se afasta do zero."""
    if den <= 0:
        raise ValueError("den must be positive")
    magnitude = (2 * abs(num) + den) // (2 * den)
    return -magnitude if num < 0 else magnitude
