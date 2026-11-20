"""Barramento síncrono de eventos."""

from collections import defaultdict
from collections.abc import Callable


class Bus:
    def __init__(self) -> None:
        self._subs: dict[str, list[Callable[[dict], None]]] = defaultdict(list)

    def subscribe(self, topic: str, fn: Callable[[dict], None]) -> None:
        self._subs[topic].append(fn)

    def publish(self, topic: str, payload: dict) -> None:
        for fn in list(self._subs[topic]):
            fn(payload)
