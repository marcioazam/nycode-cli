"""Leitura da especificação textual de um pipeline."""


def parse_spec(spec):
    """ "strip | lower" -> ["strip", "lower"]. Trechos vazios são ignorados."""
    return [part.strip() for part in spec.split("|") if part.strip()]


def format_spec(stages):
    """Inverso de parse_spec."""
    return "|".join(stages)
