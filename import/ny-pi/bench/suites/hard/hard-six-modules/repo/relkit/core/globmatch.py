"""Padrões glob para caminhos. Regras em docs/SPEC.md, seção 2."""


def glob_match(pattern: str, path: str) -> bool:
    raise NotImplementedError


def filter_paths(patterns, paths) -> list:
    raise NotImplementedError
