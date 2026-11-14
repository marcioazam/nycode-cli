from typing import Any


class RingBuffer:
    def __init__(self, n: int) -> None:
        raise NotImplementedError

    def append(self, x: Any) -> None:
        raise NotImplementedError

    def to_list(self) -> list[Any]:
        raise NotImplementedError

    def is_full(self) -> bool:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError
