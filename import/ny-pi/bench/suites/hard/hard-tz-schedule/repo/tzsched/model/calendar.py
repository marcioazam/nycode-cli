"""Calendário: conjunto de séries e de participantes."""

from tzsched.model.attendee import Attendee
from tzsched.model.series import Series


class Calendar:
    def __init__(self) -> None:
        self._series: dict[str, Series] = {}
        self._attendees: dict[str, Attendee] = {}

    def add(self, series: Series) -> None:
        if series.id in self._series:
            raise ValueError(f"série duplicada: {series.id}")
        self._series[series.id] = series

    def add_attendee(self, attendee: Attendee) -> None:
        self._attendees[attendee.name] = attendee

    def series(self) -> list[Series]:
        return [self._series[k] for k in sorted(self._series)]

    def attendee(self, name: str) -> Attendee:
        try:
            return self._attendees[name]
        except KeyError:
            raise KeyError(f"participante desconhecido: {name}") from None
