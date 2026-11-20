from collections.abc import Hashable
from typing import Any


class PriorityQueue:
    def __init__(self) -> None:
        raise NotImplementedError

    def push(self, item: Hashable, priority: Any) -> None:
        raise NotImplementedError

    def pop(self) -> Hashable:
        raise NotImplementedError

    def update(self, item: Hashable, priority: Any) -> None:
        raise NotImplementedError

    def remove(self, item: Hashable) -> None:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError

    def __contains__(self, item: Hashable) -> bool:
        raise NotImplementedError
