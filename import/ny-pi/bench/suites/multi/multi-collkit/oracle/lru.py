from collections import OrderedDict
from typing import Any


class LRUCache:
    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError(capacity)
        self._cap = capacity
        self._d: OrderedDict[Any, Any] = OrderedDict()

    def get(self, key: Any, default: Any = None) -> Any:
        if key not in self._d:
            return default
        self._d.move_to_end(key)
        return self._d[key]

    def put(self, key: Any, value: Any) -> None:
        self._d[key] = value
        self._d.move_to_end(key)
        if len(self._d) > self._cap:
            self._d.popitem(last=False)

    def __len__(self) -> int:
        return len(self._d)

    def __contains__(self, key: Any) -> bool:
        return key in self._d

    def keys(self) -> list[Any]:
        return list(self._d)
