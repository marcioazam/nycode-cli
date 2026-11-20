from collections.abc import Callable


class TokenBucket:
    def __init__(
        self, capacity: float, refill_per_s: float, clock: Callable[[], float]
    ) -> None:
        if capacity <= 0 or refill_per_s < 0:
            raise ValueError("bad bucket")
        self.capacity = capacity
        self.rate = refill_per_s
        self.clock = clock
        self.tokens = float(capacity)
        self.last = clock()

    def allow(self, cost: float = 1) -> bool:
        if cost <= 0 or cost > self.capacity:
            raise ValueError(cost)
        now = self.clock()
        dt = max(0.0, now - self.last)
        self.last = now
        self.tokens = min(self.capacity, self.tokens + dt * self.rate)
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False
