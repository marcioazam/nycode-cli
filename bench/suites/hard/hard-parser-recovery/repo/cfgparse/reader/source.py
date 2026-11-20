"""Divide o texto em linhas físicas (docs/SPEC.md, regra 1)."""


def split_lines(text: str) -> list[str]:
    lines = text.split("\n")
    return [line.removesuffix("\r") for line in lines]
