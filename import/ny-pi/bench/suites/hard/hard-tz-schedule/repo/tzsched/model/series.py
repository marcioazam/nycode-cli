"""Série recorrente: horário de parede local + fuso IANA."""

from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True)
class Series:
    id: str
    title: str
    zone: str
    start_local: datetime
    every_days: int = 7
    count: int | None = None
    until: date | None = None
    duration_min: int = 60
    attendees: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.start_local.tzinfo is not None:
            raise ValueError("start_local deve ser ingênuo (horário de parede)")
        if self.every_days <= 0 or self.duration_min <= 0:
            raise ValueError("every_days e duration_min devem ser positivos")
        if self.count is not None and self.count <= 0:
            raise ValueError("count deve ser positivo")
