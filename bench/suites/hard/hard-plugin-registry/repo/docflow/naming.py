"""Normalização de nomes de plugin."""


def normalize_name(name):
    """Devolve o nome em minúsculas e sem espaços nas pontas."""
    return name.strip().lower()
