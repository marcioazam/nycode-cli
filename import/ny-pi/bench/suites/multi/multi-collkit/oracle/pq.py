import heapq
from collections.abc import Hashable
from typing import Any


class PriorityQueue:
    def __init__(self) -> None:
        self._h: list[tuple[Any, int, Hashable]] = []
        self._live: dict[Hashable, int] = {}
        self._n = 0

    def push(self, item: Hashable, priority: Any) -> None:
        self._n += 1
        self._live[item] = self._n
        heapq.heappush(self._h, (priority, self._n, item))

    def pop(self) -> Hashable:
        while self._h:
            _, n, item = heapq.heappop(self._h)
            if self._live.get(item) == n:
                del self._live[item]
                return item
        raise IndexError("pop from empty queue")

    def update(self, item: Hashable, priority: Any) -> None:
        if item not in self._live:
            raise KeyError(item)
        self.push(item, priority)

    def remove(self, item: Hashable) -> None:
        del self._live[item]

    def __len__(self) -> int:
        return len(self._live)

    def __contains__(self, item: Hashable) -> bool:
        return item in self._live
