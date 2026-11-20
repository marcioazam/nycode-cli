"""Geração determinística de ids."""

import itertools


class Sequence:
    def __init__(self, prefix: str) -> None:
        self._prefix = prefix
        self._counter = itertools.count(1)

    def next(self) -> str:
        return f"{self._prefix}-{next(self._counter):04d}"
