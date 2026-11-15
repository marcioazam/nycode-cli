"""Ocorrência materializada, sempre em UTC."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Occurrence:
    series_id: str
    title: str
    start_utc: datetime
    end_utc: datetime
