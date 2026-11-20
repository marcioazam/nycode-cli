"""Relógios; `ManualClock` é determinístico (segundos inteiros)."""


class ManualClock:
    def __init__(self, start: int = 0) -> None:
        self._now = start

    def now(self) -> int:
        return self._now

    def advance(self, seconds: int) -> None:
        if seconds < 0:
            raise ValueError("o relógio não anda para trás")
        self._now += seconds
