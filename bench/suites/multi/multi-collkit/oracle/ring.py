from typing import Any


class RingBuffer:
    def __init__(self, n: int) -> None:
        if n < 1:
            raise ValueError(n)
        self._n = n
        self._buf: list[Any] = []
        self._start = 0

    def append(self, x: Any) -> None:
        if len(self._buf) < self._n:
            self._buf.append(x)
        else:
            self._buf[self._start] = x
            self._start = (self._start + 1) % self._n

    def to_list(self) -> list[Any]:
        return self._buf[self._start :] + self._buf[: self._start]

    def is_full(self) -> bool:
        return len(self._buf) == self._n

    def __len__(self) -> int:
        return len(self._buf)
