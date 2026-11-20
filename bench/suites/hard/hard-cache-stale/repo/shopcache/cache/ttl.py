"""Regra de expiração por tempo."""


def expires_at(written_at: int, ttl: int) -> int:
    return written_at + ttl


def is_expired(expiry: int, now: int) -> bool:
    return now > expiry
