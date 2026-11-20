"""Versões semânticas. Regras em docs/SPEC.md, seção 1."""

from relkit.types import Version


def parse_version(text) -> Version:
    raise NotImplementedError


def format_version(version: Version) -> str:
    raise NotImplementedError


def compare_versions(a, b) -> int:
    raise NotImplementedError


def bump(version, part: str) -> Version:
    raise NotImplementedError


def satisfies(version, spec: str) -> bool:
    raise NotImplementedError


def max_satisfying(versions, spec: str):
    raise NotImplementedError
