from collections.abc import Callable


class TokenBucket:
    def __init__(
        self, capacity: float, refill_per_s: float, clock: Callable[[], float]
    ) -> None:
        raise NotImplementedError

    def allow(self, cost: float = 1) -> bool:
        raise NotImplementedError
