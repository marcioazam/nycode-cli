from typing import Any


class LRUCache:
    def __init__(self, capacity: int) -> None:
        raise NotImplementedError

    def get(self, key: Any, default: Any = None) -> Any:
        raise NotImplementedError

    def put(self, key: Any, value: Any) -> None:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError

    def __contains__(self, key: Any) -> bool:
        raise NotImplementedError

    def keys(self) -> list[Any]:
        raise NotImplementedError
