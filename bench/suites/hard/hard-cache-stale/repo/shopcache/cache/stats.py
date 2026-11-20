"""Contadores de uso do cache."""

from dataclasses import dataclass


@dataclass
class Stats:
    hits: int = 0
    misses: int = 0
    purged: int = 0
    evicted: int = 0
