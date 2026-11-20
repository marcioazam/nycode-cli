import pytest
from bucket import TokenBucket


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_starts_full_and_drains():
    c = Clock()
    b = TokenBucket(3, 1, c)
    assert [b.allow() for _ in range(4)] == [True, True, True, False]


def test_refill():
    c = Clock()
    b = TokenBucket(2, 1, c)
    assert b.allow(2)
    assert not b.allow()
    c.t += 1
    assert b.allow()
    assert not b.allow()
    c.t += 0.5
    assert not b.allow()
    c.t += 0.5
    assert b.allow()


def test_capped_at_capacity():
    c = Clock()
    b = TokenBucket(2, 10, c)
    assert b.allow(2)
    c.t += 1000
    assert b.allow(2)
    assert not b.allow()


def test_failed_allow_does_not_consume():
    c = Clock()
    b = TokenBucket(5, 0, c)
    assert b.allow(3)
    assert not b.allow(3)
    assert b.allow(2)
    assert not b.allow()


def test_clock_backwards_is_safe():
    c = Clock()
    b = TokenBucket(2, 1, c)
    assert b.allow(2)
    c.t -= 50
    assert not b.allow()


def test_zero_refill_never_refills():
    c = Clock()
    b = TokenBucket(1, 0, c)
    assert b.allow()
    c.t += 10**6
    assert not b.allow()


@pytest.mark.parametrize("cap,rate", [(0, 1), (-1, 1), (1, -0.1)])
def test_bad_ctor(cap, rate):
    with pytest.raises(ValueError):
        TokenBucket(cap, rate, Clock())


@pytest.mark.parametrize("cost", [0, -1, 3])
def test_bad_cost(cost):
    b = TokenBucket(2, 1, Clock())
    with pytest.raises(ValueError):
        b.allow(cost)
